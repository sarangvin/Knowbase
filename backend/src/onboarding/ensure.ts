// Making sure a starved collection gets fixed, without waiting for a review
// that cannot happen.
//
// Growth is triggered by finishing a note. That is fine while it works and
// a dead end when it does not: `generateNextTopics` returns null after two
// failed attempts, `growSpace` logs `generation-failed` and gives up, and
// nothing anywhere retries. The reader is left with a short shelf and an
// empty buffer, and the only thing that would trigger another attempt is
// finishing a note they no longer have.
//
// That is not hypothetical. Statistics sat at two visible notes and no
// buffer after exactly one failed plan call, and the retry it was relying on
// — the ten-minute cron — is a GitHub scheduled workflow, which in practice
// ran **five times in forty-eight hours**. GitHub throttles high-frequency
// schedules on shared runners hard; the cadence in the cron expression is a
// request, not a promise.
//
// So this runs from the app itself: whenever the client asks for status,
// the server checks whether anything of that user's is starved and fixes one.
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { usageEvents } from '../db/schema.js'
import { SPACE_ROOT, archivedSpaces, getOrCreatePersonalVaultId } from '../vault/spaces.js'
import { HIDDEN_BUFFER, VISIBLE_AHEAD, revealUpTo } from '../vault/hidden.js'
import { growSpace } from './grow.js'
import { retryFailedOnboarding } from './topUp.js'
import { callsSinceQuotaReset } from '../usage/quotaWindow.js'
/** Stop when the shared daily ceiling is close. Imported rather than
 *  re-declared: two background spenders with two different ideas of the
 *  reserve is how the reserve stops existing. */
import { DAILY_CALL_BUDGET } from './topUp.js'
import { logUsageEvent } from '../usage/logEvent.js'

/** Don't attempt the same collection again for this long. */
const COOLDOWN_MS = 30 * 60 * 1000

/** And don't start *any* generation for this user more often than this.
 *
 *  This is the one that matters, and its absence is what turned the status
 *  poll into a load generator. The per-collection cooldown above stops the
 *  same collection being retried in a loop; it does nothing about
 *  *different* collections, and this account has thirty-six. The poll fires
 *  every five seconds, each firing found a collection not yet in cooldown,
 *  and the result was a plan call every five seconds — around seven hundred
 *  an hour where the baseline was thirty in two days.
 *
 *  The free tier throttles by making you wait, so that load does not fail
 *  loudly, it just makes everything slow: median draft latency went from
 *  6.5s to 30s and half of every call type started crossing its deadline.
 *  Growth that nobody asked for was starving the drafting somebody was
 *  waiting on.
 *
 *  Five minutes is twelve attempts an hour from the whole app, which is
 *  more than enough to keep shelves stocked — a shelf is three notes and a
 *  grow produces two. */
const USER_COOLDOWN_MS = 5 * 60 * 1000

/** Most collections to fix per call. One: this runs on a poll, inside a
 *  request with a 60s ceiling, and a grow is up to two twenty-second plan
 *  calls. Several starved collections are fixed over several polls. */
const MAX_PER_CALL = 1

/** Stop when the shared daily ceiling is close. Imported rather than
 *  re-declared: two background spenders with two different ideas of the
 *  reserve is how the reserve stops existing. */

export interface EnsureResult {
  retriedOnboarding?: string
  checked: number
  revealed: number
  grown: number
  added: number
  skipped?: 'quota' | 'no-key' | 'cooldown' | 'nothing-short'
}


/** Spaces this user has had a grow *attempt* on recently — successes and
 *  failures alike. Failures are what the cooldown is for, and grow.ts
 *  records those as a usage_event precisely so they can be read back. */
async function recentlyAttempted(userId: string): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT metadata->>'space' AS space
    FROM usage_events
    WHERE user_id = ${userId}
      AND metadata->>'source' IN ('grow', 'ensure')
      AND created_at > now() - ${sql.raw(`interval '${Math.round(COOLDOWN_MS / 1000)} seconds'`)}
  `)).rows as { space: string | null }[]
  return new Set(rows.map((r) => r.space).filter((s): s is string => !!s))
}

/** Has this user had *any* generation started for them recently? */
async function startedAnythingRecently(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        sql`${usageEvents.metadata}->>'source' IN ('grow', 'ensure')`,
        sql`${usageEvents.createdAt} > now() - ${sql.raw(`interval '${Math.round(USER_COOLDOWN_MS / 1000)} seconds'`)}`,
      ),
    )
  return (row?.n ?? 0) > 0
}

/**
 * Top up whatever this user has that is starved.
 *
 * Reveal first — it is free and fixes the common case on its own. Only a
 * collection that is short *and* has nothing waiting costs a model call.
 *
 * Never throws: the caller is a status poll that must stay instant, and an
 * exception here would turn a background repair into a broken page.
 */
export async function ensureStocked(userId: string): Promise<EnsureResult> {
  const out: EnsureResult = { checked: 0, revealed: 0, grown: 0, added: 0 }
  try {
    // Before anything else: a build of this user's that stalled. They are in
    // the app right now, most likely looking at the card for it, so this is
    // the best moment there will be to try again — better than waiting for a
    // cron that runs a handful of times a day.
    const again = await retryFailedOnboarding()
    if (again) {
      out.retriedOnboarding = `${again.email}: ${again.topic}`
      return out
    }

    const vaultId = await getOrCreatePersonalVaultId(userId)

    const rows = (await db.execute(sql`
      SELECT split_part(path, '/', 2) AS space,
             count(*) FILTER (WHERE content !~ '(?n)^hidden: *true'
                                AND content !~ '(?n)^last_reviewed: *[0-9]')::int AS visible,
             count(*) FILTER (WHERE content ~ '(?n)^hidden: *true')::int AS hidden
      FROM notes
      WHERE vault_id = ${vaultId} AND path LIKE ${SPACE_ROOT + '%/Topics/%'}
      GROUP BY 1
      HAVING count(*) FILTER (WHERE content !~ '(?n)^hidden: *true'
                                AND content !~ '(?n)^last_reviewed: *[0-9]') < ${VISIBLE_AHEAD}
          OR count(*) FILTER (WHERE content ~ '(?n)^hidden: *true') < ${HIDDEN_BUFFER}
      -- Emptiest shelf first: a reader with nothing to read is the urgent
      -- case, an unfilled buffer is only ever a future one.
      ORDER BY 2 ASC, 3 ASC
    `)).rows as { space: string; visible: number; hidden: number }[]

    out.checked = rows.length
    if (rows.length === 0) return { ...out, skipped: 'nothing-short' }

    const archived = await archivedSpaces(vaultId)
    const candidates = rows.filter((r) => !archived.has(r.space))

    // Free first, and unconditionally: revealing costs nothing, is not
    // subject to the cooldown, and on its own fixes every collection whose
    // buffer has something in it.
    for (const c of candidates) {
      if (c.visible >= VISIBLE_AHEAD || c.hidden === 0) continue
      out.revealed += (await revealUpTo(vaultId, c.space)).length
    }

    if (!process.env.GEMINI_API_KEY) return { ...out, skipped: 'no-key' }
    if ((await callsSinceQuotaReset()) >= DAILY_CALL_BUDGET) return { ...out, skipped: 'quota' }

    // Per user before per collection. One collection in cooldown only moves
    // the poll on to the next one, which is not a limit at all when there
    // are thirty-six of them.
    if (await startedAnythingRecently(userId)) return { ...out, skipped: 'cooldown' }

    const attempted = await recentlyAttempted(userId)
    const toGrow = candidates.filter((c) => !attempted.has(c.space)).slice(0, MAX_PER_CALL)
    if (toGrow.length === 0) return { ...out, skipped: 'cooldown' }

    for (const c of toGrow) {
      // Recorded *before* the attempt, not after. growSpace logs its own
      // outcome for most paths but not all of them, and a path that returns
      // without logging would leave no cooldown at all — which on a
      // five-second poll is not a missing metric, it is a loop.
      await logUsageEvent({
        userId,
        eventType: 'vault_sync',
        metadata: { space: c.space, source: 'ensure', visible: c.visible, hidden: c.hidden },
      })
      const res = await growSpace(userId, c.space)
      out.grown++
      out.added += res.added
    }
    return out
  } catch (err) {
    console.error('[ensure] failed', err)
    return out
  }
}
