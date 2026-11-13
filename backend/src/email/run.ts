// The onboarding emails — exactly two per account, then nothing.
//
//   1. "Your collection is ready": when their first collection is ready.
//      Sent right away from onboarding/run.ts, with the hourly pass below as
//      the backstop for one that was missed.
//   2. "Next up: <note>": about a day after the first, naming the next note
//      they have not finished. Hourly pass (GET /api/cron/notify).
//
// Only accounts created from EMAIL_START on (the existing ones were never
// told there would be email), never after an unsubscribe, and each email is
// claimed with a conditional UPDATE before it is sent, so overlapping passes
// cannot send one twice.
import { and, eq, gte, isNull, lte, sql, desc } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, onboardingJobs, vaults } from '../db/schema.js'
import { firstNoteIn } from '../vault/firstNote.js'
import { logUsageEvent } from '../usage/logEvent.js'
import { emailConfigured, sendEmail, unsubUrl, appUrl } from './send.js'
import { readyEmail, nextNoteEmail } from './messages.js'

/** Accounts created before this never get the onboarding emails. */
export const EMAIL_START = new Date('2026-11-13T00:00:00Z')
/** Gap between the ready email and the next-note email. */
const NEXT_AFTER_MS = 22 * 3_600_000

function linkTo(path: string | null, which: 'ready' | 'next'): string {
  const q = new URLSearchParams({ from: `email_${which}` })
  if (path) q.set('note', path)
  return `${appUrl()}/?${q.toString()}`
}

interface Recipient {
  id: string
  email: string
  displayName: string | null
}

const eligible = and(
  isNull(users.emailOptedOutAt),
  gte(users.createdAt, EMAIL_START),
  eq(users.role, 'user'),
)

/** Their first ready collection: the space and the note to open. */
async function firstReadyJob(userId: string) {
  const [job] = await db
    .select({ space: onboardingJobs.space, openPath: onboardingJobs.openPath })
    .from(onboardingJobs)
    .where(and(eq(onboardingJobs.userId, userId), eq(onboardingJobs.status, 'ready')))
    .orderBy(onboardingJobs.createdAt)
    .limit(1)
  return job?.space ? job : null
}

/** The note to suggest next in their own copy of the collection. */
export async function nextNoteFor(userId: string, space: string): Promise<{ path: string; title: string } | null> {
  const [v] = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(and(eq(vaults.ownerUserId, userId), eq(vaults.kind, 'personal')))
    .limit(1)
  if (!v) return null
  const n = await firstNoteIn(v.id, space)
  return n ? { path: n.path, title: n.title } : null
}

async function claim(userId: string, column: 'ready' | 'next', now: Date): Promise<boolean> {
  const col = column === 'ready' ? users.emailReadySentAt : users.emailNextSentAt
  const rows = await db
    .update(users)
    .set(column === 'ready' ? { emailReadySentAt: now } : { emailNextSentAt: now })
    .where(and(eq(users.id, userId), isNull(col), isNull(users.emailOptedOutAt)))
    .returning({ id: users.id })
  return rows.length > 0
}

async function deliver(u: Recipient, which: 'ready' | 'next', msg: { subject: string; html: string; text: string }) {
  await sendEmail({ to: u.email, userId: u.id, ...msg })
  await logUsageEvent({ userId: u.id, eventType: 'email_sent', metadata: { which } })
}

/** Email 1. Safe to call for anyone at any time: it checks eligibility and
 *  sends at most once per account. Never throws. */
export async function sendReadyEmail(userId: string, now = new Date()): Promise<boolean> {
  try {
    if (!emailConfigured()) return false
    const [u] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, userId), eligible, isNull(users.emailReadySentAt)))
    if (!u) return false
    const job = await firstReadyJob(userId)
    if (!job) return false
    if (!(await claim(userId, 'ready', now))) return false
    // Straight to the first note, not the Next Up dashboard.
    const first = await nextNoteFor(userId, job.space!)
    const url = linkTo(first?.path ?? job.openPath, 'ready')
    await deliver(u, 'ready', readyEmail({ name: u.displayName, space: job.space!, url, unsub: unsubUrl(u.id) }))
    return true
  } catch (err) {
    console.error('[email] ready email failed', userId, err)
    return false
  }
}

export interface EmailReport {
  enabled: boolean
  ready: number
  next: number
  skipped: number
  errors: number
}

/** The hourly pass: missed ready emails, then due next-note emails. */
export async function emailEveryone(now = new Date()): Promise<EmailReport> {
  const report: EmailReport = { enabled: emailConfigured(), ready: 0, next: 0, skipped: 0, errors: 0 }
  if (!report.enabled) return report

  const missedReady = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eligible,
        isNull(users.emailReadySentAt),
        sql`EXISTS (SELECT 1 FROM onboarding_jobs j WHERE j.user_id = ${users.id} AND j.status = 'ready')`,
      ),
    )
  for (const u of missedReady) if (await sendReadyEmail(u.id, now)) report.ready++

  const due = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eligible, isNull(users.emailNextSentAt), lte(users.emailReadySentAt, new Date(now.getTime() - NEXT_AFTER_MS))))
    .orderBy(desc(users.createdAt))
  for (const u of due) {
    try {
      const job = await firstReadyJob(u.id)
      const next = job ? await nextNoteFor(u.id, job.space!) : null
      if (!(await claim(u.id, 'next', now))) continue
      // Nothing left to suggest: the slot is used up anyway. Two emails is
      // the whole budget, and there is no third to save it for.
      if (!job || !next) {
        report.skipped++
        continue
      }
      await deliver(u, 'next', nextNoteEmail({ name: u.displayName, space: job.space!, title: next.title, url: linkTo(next.path, 'next'), unsub: unsubUrl(u.id) }))
      report.next++
    } catch (err) {
      report.errors++
      console.error('[email] next-note email failed', u.id, err)
    }
  }
  return report
}
