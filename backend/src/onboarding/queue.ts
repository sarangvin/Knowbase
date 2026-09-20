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
import { draftQueue, notes } from '../db/schema.js'
import { DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { draftOne } from './draftNote.js'
import { SPACE_ROOT, contributeToLibrary } from '../vault/spaces.js'

/** Notes drafted per drain. Each is a model call, and the free tier allows 15
 *  a minute across everything — small batches leave room for the calls a user
 *  is making by hand. */
const BATCH = 3

/** Stop claiming new work near the function's ceiling (60s) so a drain always
 *  finishes the note it is on rather than being killed holding a claim. */
const TIME_BUDGET_MS = 40_000

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
 * Take ownership of up to `n` jobs, atomically.
 *
 * One statement, so two drains racing cannot claim the same row: the UPDATE
 * flips status under a lock, and SKIP LOCKED means the loser takes different
 * rows rather than blocking. This is the entire concurrency design — without
 * it, the 5-second status poll would have several invocations drafting the
 * same note and paying for it several times.
 */
async function claim(n: number): Promise<ClaimedRow[]> {
  const res = await db.execute(sql`
    UPDATE draft_queue SET
      status = 'running',
      started_at = now(),
      updated_at = now(),
      attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM draft_queue
      WHERE status = 'pending'
         OR (status = 'running' AND started_at < now() - interval '${sql.raw(String(STALE_MINUTES))} minutes')
      ORDER BY created_at
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
}

/**
 * Process queued notes until the batch is done or the time budget runs out.
 *
 * Never throws: every caller is a fire-and-forget `waitUntil` behind a
 * response that has already been sent.
 */
export async function drainQueue(limit = BATCH): Promise<DrainResult> {
  const started = Date.now()
  const out: DrainResult = { claimed: 0, drafted: 0, failed: 0 }
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return out
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL

    const jobs = await claim(limit)
    out.claimed = jobs.length
    const finished: { path: string; content: string }[] = []

    for (const job of jobs) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        // Hand it back rather than starting a call we cannot finish.
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
        // Out of attempts means stop, not loop. Whatever is wrong here is not
        // going to fix itself on the fourth try.
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
      ).map((r) => `${r.vaultId} ${r.path}`),
    )

    // Owner and siblings come from the vault itself. The summary is recovered
    // from the placeholder's own first line, which is where buildTopicNote put
    // it — a worse prompt than the original plan's, but a real one.
    const byVault = new Map<string, typeof stranded>()
    for (const n of stranded) {
      if (known.has(`${n.vaultId} ${n.path}`)) continue
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
          source: 'reconcile',
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
