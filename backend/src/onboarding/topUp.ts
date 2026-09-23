// Keeping every collection stocked, for everyone, without anybody having to
// be in the app.
//
// Growth used to happen only on review: you finish a note, the client fires
// `/grow`, and that collection tops back up. That works while you are there
// and fails in every other case — the request is fire-and-forget, so a
// timeout, a closed tab or a killed invocation loses the top-up silently and
// nothing retries it. This pass is the backstop: it asks the database which
// collections are short and fixes them, on a schedule, for every user.
//
// The expensive part is the model, so the whole design is about not calling
// it. A collection at or above the threshold is skipped by a SQL predicate,
// which means an idle pass is one query and no spend at all.
//
// "Short" now means short on either shelf: fewer than three notes the reader
// can see, or fewer than three written and waiting behind them. Hidden notes
// are subtracted from the visible count rather than counted as available —
// see vault/hidden.ts.
import { and, eq, like, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, usageEvents } from '../db/schema.js'
import { SPACE_ROOT, archivedSpaces } from '../vault/spaces.js'
import { growSpace, MAX_UNREVIEWED } from './grow.js'
import { HIDDEN_BUFFER, revealUpTo } from '../vault/hidden.js'
import { drainQueue } from './queue.js'
import { logUsageEvent } from '../usage/logEvent.js'

/** How many collections one pass will grow.
 *
 *  A grow is up to two plan calls at 20s each, so two is already the most
 *  that fits a 60s invocation with room to spare. The schedule does the rest
 *  of the work: at one pass every ten minutes there is no backlog a few
 *  passes will not clear, and a cap here is what stops the first pass after
 *  a quiet week trying to grow everything at once. */
const MAX_GROWS_PER_RUN = 2

/** Wall-clock budget for the whole pass, against the 60s function ceiling. */
const RUN_BUDGET_MS = 50_000

/** Worst case for one grow: two plan attempts plus the writes. */
const WORST_GROW_MS = 42_000

/** Stop spending when the shared daily quota is nearly gone.
 *
 *  Every model call in this product comes out of one free-tier key with a
 *  500-a-day ceiling that all users share. This pass runs unattended 144
 *  times a day, so it is the one thing that could quietly drain that ceiling
 *  and leave a real person unable to start a collection. It yields first. */
const DAILY_CALL_BUDGET = 400

export interface TopUpResult {
  /** Collections found below the threshold. */
  candidates: number
  grown: number
  added: number
  drafted: number
  /** Hidden notes handed over without spending anything. */
  revealed: number
  skipped?: 'quota' | 'no-key'
}

interface Candidate {
  userId: string
  vaultId: string
  space: string
  unreviewed: number
}

/**
 * Which collections are short, neediest first.
 *
 * One query for every user at once. `last_reviewed:` followed by a digit is
 * the same test the review control and the ranking make — an empty
 * `last_reviewed:` line is not a review.
 */
export async function findShortCollections(limit: number): Promise<Candidate[]> {
  const rows = (await db.execute(sql`
    WITH per_space AS (
      SELECT v.owner_user_id AS user_id,
             v.id            AS vault_id,
             split_part(n.path, '/', 2) AS space,
             count(*)::int AS topics,
             count(*) FILTER (WHERE n.content ~ '(?n)^last_reviewed: *[0-9]')::int AS reviewed,
             -- Hidden notes are generated and waiting, not available. Counting
             -- them as unreviewed would tell this pass every collection was
             -- already stocked the moment the buffer filled, and the top-up
             -- would quietly stop doing anything.
             count(*) FILTER (WHERE n.content ~ '(?n)^hidden: *true')::int AS hidden
      FROM notes n
      JOIN vaults v ON v.id = n.vault_id
      JOIN users u ON u.id = v.owner_user_id
      WHERE v.kind = 'personal'
        AND n.path LIKE ${SPACE_ROOT + '%/Topics/%'}
        -- Growth spends the owner's model key, so an account that cannot
        -- reach the app should not be spending it either.
        AND (u.access_approved OR u.role = 'owner')
      GROUP BY 1, 2, 3
    )
    SELECT user_id, vault_id, space, topics - reviewed - hidden AS unreviewed
    FROM per_space
    WHERE topics - reviewed - hidden < ${MAX_UNREVIEWED} OR hidden < ${HIDDEN_BUFFER}
    ORDER BY topics - reviewed - hidden ASC, hidden ASC, space ASC
    LIMIT ${limit}
  `)).rows as { user_id: string; vault_id: string; space: string; unreviewed: number }[]

  return rows.map((r) => ({
    userId: r.user_id,
    vaultId: r.vault_id,
    space: r.space,
    unreviewed: r.unreviewed,
  }))
}

/** Why a pass would or would not spend anything, in one object.
 *
 *  Three different causes produce the same symptom — "no new notes" — and
 *  they are told apart only by these numbers: the shared daily quota being
 *  gone, the queue holding failed drafts, or the planner returning nothing.
 *  The last is recorded by grow.ts as a usage_event, which is why it can be
 *  read back here at all. */
export interface PassDiagnostics {
  llmCallsLast24h: number
  dailyCallBudget: number
  queue: { status: string; n: number }[]
  /** grow outcomes recorded in the last 48h, newest first. */
  recentGrows: { at: string; space: string | null; outcome: string | null; count: number | null }[]
  /** Model calls in the last 48h by source, and how many of each timed out.
   *  meter.ts records `timedOut: true` on the event, which is the only place
   *  a per-call deadline leaves a trace. */
  calls: { source: string | null; n: number; timedOut: number }[]
  hasKey: boolean
}

export async function passDiagnostics(): Promise<PassDiagnostics> {
  const calls = await callsInLastDay()

  const q = (await db.execute(sql`
    SELECT status, count(*)::int AS n FROM draft_queue GROUP BY 1 ORDER BY 1
  `)).rows as { status: string; n: number }[]

  const grows = (await db.execute(sql`
    SELECT created_at, metadata
    FROM usage_events
    WHERE event_type IN ('vault_sync', 'note_write')
      AND metadata->>'source' IN ('grow', 'cron-top-up')
      AND created_at > now() - interval '48 hours'
    ORDER BY created_at DESC
    LIMIT 25
  `)).rows as { created_at: Date; metadata: Record<string, unknown> | null }[]

  const bySource = (await db.execute(sql`
    SELECT metadata->>'source' AS source,
           count(*)::int AS n,
           count(*) FILTER (WHERE metadata->>'timedOut' = 'true')::int AS timed_out
    FROM usage_events
    WHERE event_type = 'llm_call' AND created_at > now() - interval '48 hours'
    GROUP BY 1
    ORDER BY 2 DESC
  `)).rows as { source: string | null; n: number; timed_out: number }[]

  return {
    llmCallsLast24h: calls,
    dailyCallBudget: DAILY_CALL_BUDGET,
    queue: q,
    calls: bySource.map((r) => ({ source: r.source, n: r.n, timedOut: r.timed_out })),
    recentGrows: grows.map((g) => ({
      at: new Date(g.created_at).toISOString(),
      space: (g.metadata?.space as string) ?? null,
      outcome: (g.metadata?.outcome as string) ?? (g.metadata?.reason as string) ?? null,
      count: (g.metadata?.count as number) ?? (g.metadata?.added as number) ?? null,
    })),
    hasKey: !!process.env.GEMINI_API_KEY,
  }
}

export interface ShelfReport {
  space: string
  /** Unfinished and on the shelf. */
  visible: number
  /** Generated and waiting behind it. */
  hidden: number
  /** Of those, still one-line stubs the draft queue has not reached. */
  hiddenPending: number
  visiblePending: number
  reviewed: number
  topics: number
}

/**
 * What both shelves actually hold, per collection.
 *
 * Read-only and spends nothing. It exists because the buffer's failure mode
 * is silence: a shelf that is short and a buffer that is empty look exactly
 * like a shelf that is short and a buffer that is full, from outside. The
 * counts are the difference between knowing and guessing.
 */
export async function shelfReport(limit: number): Promise<ShelfReport[]> {
  const rows = (await db.execute(sql`
    SELECT split_part(n.path, '/', 2) AS space,
           count(*)::int AS topics,
           count(*) FILTER (WHERE n.content ~ '(?n)^last_reviewed: *[0-9]')::int AS reviewed,
           count(*) FILTER (WHERE n.content ~ '(?n)^hidden: *true')::int AS hidden,
           count(*) FILTER (WHERE n.content ~ '(?n)^hidden: *true'
                              AND n.content ~ '(?n)^pending: *true')::int AS hidden_pending,
           count(*) FILTER (WHERE n.content !~ '(?n)^hidden: *true'
                              AND n.content ~ '(?n)^pending: *true')::int AS visible_pending
    FROM notes n
    JOIN vaults v ON v.id = n.vault_id
    JOIN users u ON u.id = v.owner_user_id
    WHERE v.kind = 'personal'
      AND n.path LIKE ${SPACE_ROOT + '%/Topics/%'}
      AND (u.access_approved OR u.role = 'owner')
    GROUP BY 1
    ORDER BY 1
    LIMIT ${limit}
  `)).rows as {
    space: string
    topics: number
    reviewed: number
    hidden: number
    hidden_pending: number
    visible_pending: number
  }[]

  return rows.map((r) => ({
    space: r.space,
    visible: r.topics - r.reviewed - r.hidden,
    hidden: r.hidden,
    hiddenPending: r.hidden_pending,
    visiblePending: r.visible_pending,
    reviewed: r.reviewed,
    topics: r.topics,
  }))
}

async function callsInLastDay(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.eventType, 'llm_call'),
        sql`${usageEvents.createdAt} > now() - interval '24 hours'`,
      ),
    )
  return row?.n ?? 0
}

/**
 * One pass. Never throws: its only caller is a scheduled request that nobody
 * reads, and an exception there is a silent outage rather than a message.
 */
export async function topUpEveryone(): Promise<TopUpResult> {
  const started = Date.now()
  const out: TopUpResult = { candidates: 0, grown: 0, added: 0, drafted: 0, revealed: 0 }

  try {
    if (!process.env.GEMINI_API_KEY) return { ...out, skipped: 'no-key' }

    // Asked before the candidate query, because a quota that is gone makes
    // the rest of the pass pointless.
    if ((await callsInLastDay()) >= DAILY_CALL_BUDGET) return { ...out, skipped: 'quota' }

    // A few more than we will grow, so archived ones can be filtered out
    // without the pass coming back empty-handed.
    const candidates = await findShortCollections(MAX_GROWS_PER_RUN * 4)
    out.candidates = candidates.length

    const archivedByVault = new Map<string, Set<string>>()
    for (const c of candidates) {
      if (out.grown >= MAX_GROWS_PER_RUN) break
      if (Date.now() - started + WORST_GROW_MS > RUN_BUDGET_MS) break

      // An archived collection is one its owner set aside; topping it up
      // would spend a model call filling a shelf they closed.
      let archived = archivedByVault.get(c.vaultId)
      if (!archived) {
        archived = await archivedSpaces(c.vaultId)
        archivedByVault.set(c.vaultId, archived)
      }
      if (archived.has(c.space)) continue

      // Free first. A shelf that is short while notes sit hidden behind it
      // needs no model call at all, and this pass runs for people who are
      // not in the app — so it is the only thing that will fix a collection
      // whose owner has nothing left to review and therefore nothing that
      // would trigger a reveal.
      const opened = await revealUpTo(c.vaultId, c.space)
      out.revealed += opened.length

      const res = await growSpace(c.userId, c.space)
      out.grown++
      out.added += res.added

      // Attributed to the user whose collection grew, because that is whose
      // quota it spent. There is deliberately no pass-level summary row:
      // usage_events.user_id is NOT NULL, and the only way to write one
      // would be to pin system work on somebody's account, which would make
      // the per-user figures in admin a lie. An idle pass leaving no trace
      // is fine — a cron that has stopped shows up as collections sitting
      // below the threshold, which is a better signal than a heartbeat.
      void logUsageEvent({
        userId: c.userId,
        eventType: 'vault_sync',
        metadata: { space: c.space, source: 'cron-top-up', added: res.added, reason: res.reason },
      })
    }

    // Whatever was just created is a placeholder until something drafts it.
    // The status poll only runs while somebody has the app open, which is
    // exactly the case this pass exists to cover.
    if (Date.now() - started < RUN_BUDGET_MS - 35_000) {
      const drained = await drainQueue()
      out.drafted = drained.drafted
    }

    console.log('[top-up]', JSON.stringify({ ...out, ms: Date.now() - started }))
    return out
  } catch (err) {
    console.error('[top-up] pass failed', err)
    return out
  }
}
