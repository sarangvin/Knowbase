// How many collections a plan may have, and how many it may start in a day.
//
// Two different questions, deliberately answered from two different places.
//
// **Active** is about what you have, so it is counted from the vault: the
// collections that exist, minus the archived ones. Archiving is how you make
// room under the cap without losing anything, which is the whole reason that
// feature is worth having here. Deleting frees a slot too.
//
// **Per day** is about what you spend, so it is counted from a ledger that
// outlives what it paid for. A daily limit you can reset by deleting this
// morning's collection is not a limit, and each one costs six model calls
// against a shared 500-a-day ceiling.
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { collectionStarts } from '../db/schema.js'
import { listUserSpaces, archivedSpaces } from '../vault/spaces.js'

/** One table, so a limit and the copy describing it cannot disagree. Every
 *  account is on `free` today; the shape is here so a paid tier is a number
 *  rather than a refactor. */
interface PlanLimits {
  /** Collections that are not archived. */
  active: number
  /** New collections started in one local day. */
  perDay: number
}

const BY_PLAN: Record<string, PlanLimits> = {
  free: { active: 5, perDay: 3 },
}
const DEFAULT_LIMITS: PlanLimits = { active: 5, perDay: 3 }

export function collectionLimits(planTier?: string | null): PlanLimits {
  return BY_PLAN[planTier ?? 'free'] ?? DEFAULT_LIMITS
}

export interface CollectionAllowance {
  limits: PlanLimits
  activeCount: number
  startedToday: number
  /** Null when they may start one; otherwise the reason, written to be read
   *  by the person who hit it. */
  blocked: string | null
}

export async function collectionAllowance(
  userId: string,
  vaultId: string,
  day: string,
  planTier?: string | null,
): Promise<CollectionAllowance> {
  const limits = collectionLimits(planTier)

  const [spaces, archived, startedRow] = await Promise.all([
    listUserSpaces(vaultId),
    archivedSpaces(vaultId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(collectionStarts)
      .where(and(eq(collectionStarts.userId, userId), eq(collectionStarts.day, day)))
      .then((r) => r[0]),
  ])

  const activeCount = spaces.filter((s) => !archived.has(s)).length
  const startedToday = startedRow?.n ?? 0

  // Active first: it is the one they can do something about right now, and
  // telling someone to come back tomorrow when the real problem is a full
  // shelf sends them away for no reason.
  let blocked: string | null = null
  if (activeCount >= limits.active) {
    blocked = `You have ${activeCount} collections on the go, which is the most on the free plan. Archive or delete one to start another.`
  } else if (startedToday >= limits.perDay) {
    blocked = `That's ${startedToday} new collections today, which is the daily limit on the free plan. You can start another tomorrow.`
  }

  return { limits, activeCount, startedToday, blocked }
}

/** Record a start. Called only once the job is actually being created, so a
 *  request that was refused never counts against the day. */
export async function recordCollectionStart(userId: string, topic: string, day: string): Promise<void> {
  await db.insert(collectionStarts).values({ userId, topic, day })
}
