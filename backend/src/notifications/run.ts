// The daily reminder pass, run every hour by .github/workflows/notify.yml.
//
// Who: only accounts that turned notifications on in Settings AND have at
// least one device subscription. Nothing else is ever sent anything.
//
// When: 24 hours after the last thing they completed — a lesson (note
// review), the quiz, or the flashcards — and again every 24 hours after that
// while they stay away, never more than one a day on their own calendar.
//
// Until: a week without opening the app. After seven days unseen the
// reminders stop; opening the app again starts them back up.
//
// What: if yesterday was a missed day that a streak freeze covered, they are
// told so (once per frozen day). Otherwise the next reminder in the rotation
// (messages.ts).
import webpush from 'web-push'
import { and, eq, exists, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, pushSubscriptions } from '../db/schema.js'
import { goalDays, computeStreak, shift, boughtFreezeDays, type Streak } from '../usage/streak.js'
import { REMINDERS, freezeUsedMessage, type PushMessage } from './messages.js'

const DAY_MS = 24 * 3_600_000
/** Stop reminding someone who has not opened the app in this long. */
const SEEN_CUTOFF_DAYS = 7

let configuredKeys: string | null = null
/** VAPID keys are read lazily, like the other optional integrations, so the
 *  app boots without them and this pass just reports that it is off. */
export function pushConfigured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  if (configuredKeys !== pub + priv) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:sarangvin42@gmail.com', pub, priv)
    configuredKeys = pub + priv
  }
  return true
}

/** YYYY-MM-DD on the reader's calendar. Falls back to UTC for a zone this
 *  runtime does not know rather than skipping them. */
export function dayIn(tz: string | null, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

export type Decision = 'none' | 'reminder' | 'freeze'

export interface DecideInput {
  now: Date
  /** When they last completed a lesson, quiz or deck; else when they opted in. */
  anchor: Date | null
  lastSentAt: Date | null
  tz: string | null
  streak: Streak
  freezeDayNotified: string | null
}

/** Pure, so the timing rules can be tested without a database. */
export function decide(i: DecideInput): Decision {
  if (!i.anchor) return 'none'
  const elapsed = i.now.getTime() - i.anchor.getTime()
  if (elapsed < DAY_MS) return 'none'
  // The most recent 24-hour mark since the last task. One notification per mark.
  const due = new Date(i.anchor.getTime() + Math.floor(elapsed / DAY_MS) * DAY_MS)
  if (i.lastSentAt && i.lastSentAt >= due) return 'none'
  const today = dayIn(i.tz, i.now)
  // And never two on the same calendar day, whatever the marks say.
  if (i.lastSentAt && dayIn(i.tz, i.lastSentAt) === today) return 'none'
  const yesterday = shift(today, -1)
  if (i.streak.frozen.includes(yesterday) && i.freezeDayNotified !== yesterday) return 'freeze'
  return 'reminder'
}

/** When the reader last completed any of the three tasks. */
async function lastTaskAt(userId: string): Promise<Date | null> {
  const r = await db.execute(sql`
    SELECT greatest(
      (SELECT max(created_at) FROM usage_events WHERE user_id = ${userId} AND event_type = 'note_review'),
      (SELECT max(completed_at) FROM quizzes WHERE user_id = ${userId}),
      (SELECT max((c->>'turnedAt')::timestamptz)
         FROM flashcard_decks d, jsonb_array_elements(d.cards) c
         WHERE d.user_id = ${userId}
           AND jsonb_array_length(d.cards) > 0
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.cards) x WHERE x->>'turnedAt' IS NULL))
    ) AS last
  `)
  const last = (r.rows[0] as { last: string | Date | null } | undefined)?.last
  return last ? new Date(last) : null
}

/** Send to every device the account has opted in on. Subscriptions the push
 *  service says are gone (404/410) are deleted; anything else is logged. */
export async function sendToUser(userId: string, msg: PushMessage): Promise<number> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  let delivered = 0
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...msg, url: '/' }),
        { TTL: 12 * 3600 },
      )
      delivered++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id))
      } else {
        console.error('[notify] push failed', userId, status, err)
      }
    }
  }
  return delivered
}

export interface NotifyReport {
  enabled: boolean
  checked: number
  reminders: number
  freezes: number
  errors: number
}

export async function notifyEveryone(now = new Date()): Promise<NotifyReport> {
  const report: NotifyReport = { enabled: pushConfigured(), checked: 0, reminders: 0, freezes: 0, errors: 0 }
  if (!report.enabled) return report

  const candidates = await db
    .select({
      id: users.id,
      enabledAt: users.notificationsEnabledAt,
      tz: users.notifyTimezone,
      lastSentAt: users.notifyLastSentAt,
      cursor: users.notifyCursor,
      freezeDay: users.notifyFreezeDay,
      bonusCount: users.bonusFreezes,
      bonusFrom: users.bonusFreezesFrom,
      startingFreezes: users.startingFreezes,
    })
    .from(users)
    .where(
      and(
        eq(users.notificationsEnabled, true),
        gte(users.lastSeenAt, new Date(now.getTime() - SEEN_CUTOFF_DAYS * DAY_MS)),
        exists(db.select({ one: sql`1` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, users.id))),
      ),
    )

  for (const u of candidates) {
    report.checked++
    try {
      const anchor = (await lastTaskAt(u.id)) ?? u.enabledAt
      const today = dayIn(u.tz, now)
      const streak = computeStreak(await goalDays(u.id), today, {
        count: u.bonusCount,
        from: u.bonusFrom,
        start: u.startingFreezes,
        bought: await boughtFreezeDays(u.id),
      })
      const decision = decide({ now, anchor, lastSentAt: u.lastSentAt, tz: u.tz, streak, freezeDayNotified: u.freezeDay })
      if (decision === 'none') continue

      // Claim the send before making it: if two passes overlap, only the one
      // whose update lands sends anything.
      const claimed = await db
        .update(users)
        .set({
          notifyLastSentAt: now,
          ...(decision === 'freeze'
            ? { notifyFreezeDay: shift(today, -1) }
            : { notifyCursor: sql`${users.notifyCursor} + 1` }),
        })
        .where(
          and(
            eq(users.id, u.id),
            u.lastSentAt ? eq(users.notifyLastSentAt, u.lastSentAt) : isNull(users.notifyLastSentAt),
          ),
        )
        .returning({ id: users.id })
      if (!claimed.length) continue

      const msg = decision === 'freeze' ? freezeUsedMessage(streak.freezes, streak.days) : REMINDERS[u.cursor % REMINDERS.length]
      await sendToUser(u.id, msg)
      if (decision === 'freeze') report.freezes++
      else report.reminders++
    } catch (err) {
      report.errors++
      console.error('[notify] pass failed for', u.id, err)
    }
  }
  return report
}
