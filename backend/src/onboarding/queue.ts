// The global queue of notes still to be written, and the worker that drains it.
//
// Drafting used to happen inline, inside whichever request asked for it. That
// works right up until it doesn't: a run that overruns the function's time
// limit, or an invocation killed mid-flight, leaves the note as a one-line
// placeholder and there is nothing, anywhere, that knows to try again. Three
// notes in one user's vault sat in exactly that state until this existed.
//
// So the work is written down before it is attempted. Any invocation can pick
// up what an earlier one dropped, and a note that fails is retried rather
// than abandoned.
//
// There is no long-running worker to put this on — the whole backend is a
// serverless function — so "constantly processed" means every invocation that
// notices pending work kicks a drain behind its own response. The status poll
// the onboarding banner already makes every five seconds is the heartbeat;
// the claim below is what makes overlapping drains harmless rather than
// destructive.
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { draftQueue, notes, onboardingJobs } from '../db/schema.js'
import { DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { timeoutFor } from '../llm/meter.js'
import { draftOne } from './draftNote.js'
import { SPACE_ROOT, contributeToLibrary } from '../vault/spaces.js'
import { isHidden } from '../vault/hidden.js'

/** Notes drafted per drain, in sequence.
 *
 *  It was one, because under the old 60s ceiling a draft that normally
 *  takes 4s but has been observed at 28 could not be attempted three times
 *  in a row. The ceiling is 240s now, so three fit with room for the writes
 *  either side.
 *
 *  This is the safe way to go faster, and MAX_IN_FLIGHT is not: these run
 *  one after another, so each pays only its own latency and nothing is
 *  contended. The cost of an invocation dying part-way is bounded the same
 *  way it always was — the rows go back to 'pending' and are reclaimed. */
const BATCH = 3

/** The wall this has to stay inside when no caller supplies one: the
 *  function's maxDuration in vercel.json, less the response and the
 *  bookkeeping either side of the draft. A caller that already spent part of
 *  the invocation passes its own deadline instead. */
const TIME_BUDGET_MS = 210_000

/** The slowest single job worth planning for: the draft call's own timeout
 *  (30s, in llm/meter.ts) plus the reads and the write around it.
 *
 *  It used to be a guess at how slow the model might be — 30s, against a
 *  worst observed 28s. Then one answered in 55.6s and took the invocation
 *  with it. A guess is the wrong instrument: the call now has a deadline of
 *  its own, so this is derived from that deadline rather than from a sample
 *  of past latencies that the next model change invalidates.
 *
 *  The budget is checked against now + THIS, not elapsed alone. Checking
 *  elapsed alone is the bug that killed /grow: a job could legally start at
 *  39.9s and then run for 28 more, half a minute past the ceiling. */
const WORST_CASE_JOB_MS = timeoutFor('queue-draft') + 5_000

/** How long a claimed job is treated as still in flight.
 *
 *  Set to the worst-case job time, and it has to move when that does: it was
 *  30s against a 30s draft deadline, and the deadline is 60s now. Left at
 *  30 it would have declared a perfectly healthy draft finished halfway
 *  through and let a second start beside it — the stampede it exists to
 *  prevent. */
const IN_FLIGHT_SECONDS = 65

/** How many drafts may be in flight across the whole system at once.
 *
 *  **One. Measured, not guessed — and it was three for about three hours,
 *  which is how the measurement exists.**
 *
 *  Hourly p50 for a draft call, from usage_events:
 *
 *      until 13:00 UTC   p50 ~6.5s   p95 ~7.5s    0 timeouts in 90 calls
 *      14:00 UTC         p50  36.6s  p95 56.3s    9 timeouts in 65
 *      15:00 UTC         p50  31.0s  p95 58.2s   40 timeouts in 87
 *
 *  The model did not get slower; it got shared. The free tier throttles by
 *  making you wait rather than by refusing, so three calls at once are not
 *  three times the work done — they are one call's work taking three times
 *  as long, with a p95 that then sits *on* the deadline. Every call that
 *  crosses it is lost entirely and still spends its quota.
 *
 *  The arithmetic is not close. Serial at 6.5s is about nine drafts a
 *  minute and wastes nothing. Three-way at 31s with 46% timing out is about
 *  three useful drafts a minute and burns the rest of the quota learning
 *  that. Throughput was never the constraint here anyway — the backlog is
 *  single digits and what limits it is how often an invocation runs, not
 *  how many drafts each one may start.
 *
 *  BATCH is the knob that actually helps: those drafts run in sequence
 *  inside one invocation, so three of them cost one request's latency each
 *  and nothing is contended. */
const MAX_IN_FLIGHT = 1

/** A 'running' row older than this is assumed dead and is reclaimed. Longer
 *  than any legitimate single draft (~15s on flash-lite, ~55s on a thinking
 *  model) so a slow run is never stolen from itself. */
const STALE_MINUTES = 5

/** After this many failures the job stops being retried. Whatever is wrong is
 *  not going to fix itself, and an endlessly retried job burns the same quota
 *  as a useful one. */
const MAX_ATTEMPTS = 3

export interface QueueItem {
  userId: string
  vaultId: string
  path: string
  space: string
  title: string
  summary: string
  siblings: string[]
  source?: string
}

/** Add notes to the queue. Idempotent per (vault, path): re-enqueueing a note
 *  that is already waiting is a no-op, which is what makes it safe to call
 *  from anything that might run twice. */
export async function enqueueDrafts(items: QueueItem[]): Promise<number> {
  if (items.length === 0) return 0
  const rows = await db
    .insert(draftQueue)
    .values(
      items.map((i) => ({
        userId: i.userId,
        vaultId: i.vaultId,
        path: i.path,
        space: i.space,
        title: i.title,
        summary: i.summary,
        siblings: i.siblings,
        source: i.source ?? 'grow',
      })),
    )
    .onConflictDoNothing({ target: [draftQueue.vaultId, draftQueue.path] })
    .returning({ id: draftQueue.id })
  return rows.length
}

/** How much work is outstanding, for the status poll and the admin panel. */
export async function queueDepth(): Promise<{ pending: number; running: number; failed: number }> {
  const rows = await db
    .select({ status: draftQueue.status, n: sql<number>`count(*)::int` })
    .from(draftQueue)
    .groupBy(draftQueue.status)
  const get = (s: string) => rows.find((r) => r.status === s)?.n ?? 0
  return { pending: get('pending'), running: get('running'), failed: get('failed') }
}

interface ClaimedRow {
  id: string
  userId: string
  vaultId: string
  path: string
  space: string
  title: string
  summary: string
  siblings: string[]
  attempts: number
}

/**
 * Take ownership of up to `n` jobs — but only if nothing else is running.
 *
 * One statement, so two drains racing cannot claim the same row: the UPDATE
 * flips status under a lock, and SKIP LOCKED means the loser takes different
 * rows rather than blocking.
 *
 * SKIP LOCKED alone was not enough. It stops two drains taking the *same*
 * row; it does nothing to stop ten drains working on ten *different* rows,
 * and the status poll kicks one every five seconds. That stampede is what
 * turned a 4s draft into a 28s one against a 15-requests-per-minute model
 * limit. The NOT EXISTS below is the fix: claim nothing while another job is
 * in flight, so the queue runs strictly one job at a time.
 *
 * A Postgres advisory lock was the obvious alternative and is wrong here.
 * `pg_advisory_lock` is session-scoped, and `db` is a connection pool — the
 * unlock can land on a different connection than the lock did, and then the
 * lock is never released and the queue wedges permanently. A predicate over
 * rows we already have is pool-safe and self-expiring.
 *
 * The pacing falls out of it: one job at a time, each ~4s, is about 12 model
 * calls a minute — inside the limit, without a second throttle to keep in
 * step with Google's published numbers by hand.
 */
async function claim(n: number): Promise<ClaimedRow[]> {
  const res = await db.execute(sql`
    UPDATE draft_queue SET
      status = 'running',
      started_at = now(),
      updated_at = now(),
      attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM draft_queue q
      WHERE (
              q.status = 'pending'
              OR (q.status = 'running' AND q.started_at < now() - interval '${sql.raw(String(STALE_MINUTES))} minutes')
            )
        AND (
              SELECT count(*) FROM draft_queue r
              WHERE r.status = 'running'
                AND r.started_at > now() - interval '${sql.raw(String(IN_FLIGHT_SECONDS))} seconds'
            ) < ${MAX_IN_FLIGHT}
      -- Onboarding first, then oldest.
      --
      -- Strict FIFO is the wrong order here, and it fails in exactly one
      -- direction: somebody creating their first collection queues behind
      -- every top-up draft already waiting, and their space — the only
      -- thing they have — fills in last. A grow draft is a fourth note in a
      -- collection the reader already has; an onboarding draft is whether
      -- the product works at all for a person who has just arrived.
      --
      -- Within each class it is still oldest-first, so this starves nothing;
      -- it only reorders between classes, and onboarding is a burst that
      -- drains.
      ORDER BY (q.source = 'onboarding') DESC, q.created_at
      LIMIT ${n}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id, vault_id, path, space, title, summary, siblings, attempts
  `)
  const rows = (res as unknown as { rows?: Record<string, unknown>[] }).rows ?? (res as unknown as Record<string, unknown>[])
  return (rows ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    vaultId: String(r.vault_id),
    path: String(r.path),
    space: String(r.space),
    title: String(r.title),
    summary: String(r.summary ?? ''),
    siblings: Array.isArray(r.siblings) ? (r.siblings as string[]) : [],
    attempts: Number(r.attempts ?? 1),
  }))
}

/** Google's 429, or a quota message. Distinguished from a real failure
 *  because it says nothing about this job — only about how many other calls
 *  happened to be in flight. */
function isRateLimited(message: string): boolean {
  return /\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(message)
}

/** Put a job back without charging it an attempt. */
async function refund(id: string, error: string): Promise<void> {
  await db
    .update(draftQueue)
    .set({ status: 'pending', lastError: error, attempts: sql`greatest(${draftQueue.attempts} - 1, 0)`, updatedAt: new Date() })
    .where(eq(draftQueue.id, id))
}

async function finish(id: string, status: 'done' | 'pending' | 'failed', error?: string): Promise<void> {
  await db
    .update(draftQueue)
    .set({ status, lastError: error ?? null, updatedAt: new Date() })
    .where(eq(draftQueue.id, id))
}

/** True while the note still holds the placeholder we are replacing. A note
 *  the user has opened and edited in the meantime is left exactly as it is —
 *  their text outranks a draft they never asked to wait for. */
function isStillPlaceholder(content: string): boolean {
  return /_A fuller draft of this note is being written/.test(content)
}

export interface DrainResult {
  claimed: number
  drafted: number
  failed: number
  /** Nothing was claimed — the queue is empty, or another job is in flight.
   *  The common case under a 5s poll, and not a problem: it costs one
   *  cheap query. */
  skipped?: boolean
}

/**
 * Process queued notes until the batch is done or the time budget runs out.
 *
 * Never throws: every caller is a fire-and-forget `waitUntil` behind a
 * response that has already been sent.
 */
export async function drainQueue(limit = BATCH, deadline?: number): Promise<DrainResult> {
  // An absolute wall-clock deadline, not "time since this function started".
  // /grow calls a plan first and then this, and a drain that measures only
  // its own elapsed time cannot see the 20s already spent by the invocation
  // it shares — which is how a plan plus a draft used to overrun 60s.
  const endBy = deadline ?? Date.now() + TIME_BUDGET_MS
  const out: DrainResult = { claimed: 0, drafted: 0, failed: 0, skipped: false }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return out
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL

  try {
    // claim() returns nothing while another job is in flight, so overlapping
    // drains cost one cheap query rather than a second model call.
    const jobs = await claim(limit)
    if (jobs.length === 0) out.skipped = true
    out.claimed = jobs.length
    const finished: { path: string; content: string }[] = []

    for (const job of jobs) {
      if (Date.now() + WORST_CASE_JOB_MS > endBy) {
        // Hand it back rather than starting a call we cannot finish. The
        // next drain picks it up; there is always a next drain.
        await finish(job.id, 'pending')
        continue
      }
      try {
        const existing = await db
          .select({ content: notes.content })
          .from(notes)
          .where(and(eq(notes.vaultId, job.vaultId), eq(notes.path, job.path)))
          .limit(1)
        // The note is gone (account reset) or already written (a race, or the
        // user edited it). Either way there is nothing left to do.
        if (!existing[0] || !isStillPlaceholder(existing[0].content)) {
          await finish(job.id, 'done')
          continue
        }

        const content = await draftOne(
          apiKey,
          model,
          job.space,
          { path: job.path, title: job.title, summary: job.summary, placeholder: existing[0].content },
          job.siblings,
          job.userId,
          'queue-draft',
        )
        if (!content) throw new Error('draft returned nothing')

        // Re-check under the write: the draft call takes seconds, and the
        // user may have opened and edited the note during them.
        const still = await db
          .select({ content: notes.content })
          .from(notes)
          .where(and(eq(notes.vaultId, job.vaultId), eq(notes.path, job.path)))
          .limit(1)
        if (!still[0] || !isStillPlaceholder(still[0].content)) {
          await finish(job.id, 'done')
          continue
        }

        await db
          .update(notes)
          .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
          .where(and(eq(notes.vaultId, job.vaultId), eq(notes.path, job.path)))
        await finish(job.id, 'done')
        finished.push({ path: job.path, content })
        out.drafted++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (isRateLimited(message)) {
          // Not this job's fault, and trying it again in a minute will
          // probably work. Charging it an attempt would let three unlucky
          // minutes permanently kill a note that was never broken.
          await refund(job.id, message)
          console.warn(`[queue] ${job.path} rate-limited, requeued:`, message)
          continue
        }
        // Out of attempts means stop, not loop. Whatever is wrong here is not
        // going to fix itself on the fourth try.
        // A timeout is charged an attempt like any other failure, unlike a
        // 429. It is not the job's fault either, but a model too slow to
        // answer in 30s will still be too slow on the next poll, and three
        // free retries a minute is how a quota gets spent on nothing. Three
        // attempts, then it lands in admin with a Retry button and a human
        // decides.
        await finish(job.id, job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', message)
        if (job.attempts >= MAX_ATTEMPTS) out.failed++
        console.warn(`[queue] ${job.path} attempt ${job.attempts} failed:`, message)
      }
    }

    if (finished.length > 0) {
      await contributeToLibrary(finished).catch((err) =>
        console.warn('[queue] library contribution failed (ignored):', err),
      )
    }
    return out
  } catch (err) {
    console.error('[queue] drain failed', err)
    return out
  }
}

/**
 * Find placeholder notes that no job is tracking, and enqueue them.
 *
 * The queue is only a complete account of outstanding work if something
 * reconciles it against reality. Notes stranded before this table existed
 * have no job; so would any note whose enqueue succeeded and whose row was
 * later lost. This is what makes the queue self-healing rather than merely
 * a list of things we remembered to write down.
 */
export async function reconcileQueue(): Promise<number> {
  try {
    const stranded = await db
      .select({ vaultId: notes.vaultId, path: notes.path, content: notes.content })
      .from(notes)
      .where(and(like(notes.path, `${SPACE_ROOT}%/Topics/%`), like(notes.content, '%fuller draft of this note is being written%')))
      .limit(50)
    if (stranded.length === 0) return 0

    const known = new Set(
      (
        await db
          .select({ vaultId: draftQueue.vaultId, path: draftQueue.path })
          .from(draftQueue)
          .where(inArray(draftQueue.status, ['pending', 'running', 'failed']))
      ).map((r) => JSON.stringify([r.vaultId, r.path])),
    )

    // Owner and siblings come from the vault itself. The summary is recovered
    // from the placeholder's own first line, which is where buildTopicNote put
    // it — a worse prompt than the original plan's, but a real one.
    const byVault = new Map<string, typeof stranded>()
    for (const n of stranded) {
      if (known.has(JSON.stringify([n.vaultId, n.path]))) continue
      const list = byVault.get(n.vaultId) ?? []
      list.push(n)
      byVault.set(n.vaultId, list)
    }
    if (byVault.size === 0) return 0

    const items: QueueItem[] = []
    for (const [vaultId, list] of byVault) {
      const owner = await db.query.vaults.findFirst({ where: (v, { eq: e }) => e(v.id, vaultId) })
      // The global corpus has no owner to bill the call to, and its copies are
      // only ever inserted from somebody else's finished notes anyway.
      if (!owner?.ownerUserId) continue
      const all = await db
        .select({ path: notes.path })
        .from(notes)
        .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}%/Topics/%`)))

      // Which of this owner's collections came from an onboarding run.
      //
      // A note rescued from the floor has to go back with the priority it
      // had. Everything reconcile found used to be requeued as 'reconcile',
      // which is not 'onboarding' — so a first collection's notes, the ones
      // most worth hurrying, came back and queued behind every top-up draft
      // already waiting. The rescue quietly demoted exactly the work it was
      // rescuing.
      const onboarded = new Set(
        (
          await db
            .select({ space: onboardingJobs.space })
            .from(onboardingJobs)
            .where(eq(onboardingJobs.userId, owner.ownerUserId))
        )
          .map((r) => r.space)
          .filter((x): x is string => !!x),
      )
      for (const n of list) {
        const space = n.path.slice(SPACE_ROOT.length).split('/')[0]
        const prefix = `${SPACE_ROOT}${space}/Topics/`
        items.push({
          userId: owner.ownerUserId,
          vaultId,
          path: n.path,
          space,
          title: (n.path.split('/').pop() ?? '').replace(/\.md$/i, ''),
          summary: summaryFromPlaceholder(n.content),
          siblings: all
            .filter((a) => a.path.startsWith(prefix))
            .map((a) => (a.path.split('/').pop() ?? '').replace(/\.md$/i, '')),
          // Hidden notes are the growth buffer, never part of a first
          // collection — so a visible stub in a space that was onboarded is
          // one of that plan's own notes, whatever put it back on the floor.
          source: onboarded.has(space) && !isHidden(n.content) ? 'onboarding' : 'reconcile',
        })
      }
    }
    const added = await enqueueDrafts(items)
    if (added > 0) console.log(`[queue] reconciled ${added} stranded placeholder note(s)`)
    return added
  } catch (err) {
    console.error('[queue] reconcile failed', err)
    return 0
  }
}

/** The one-line summary buildTopicNote wrote into the placeholder body. */
function summaryFromPlaceholder(content: string): string {
  const section = content.match(/^## AI Notes\n\n([\s\S]*?)(?:\n_A fuller draft|\n## )/m)
  return (section?.[1] ?? '').trim().slice(0, 500)
}
