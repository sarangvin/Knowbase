// The daily streak, and the graduation it earns a new account.
//
// A day counts when the reader did any one of three things:
//   - read a new note: finished a note they had never finished before
//   - completed the day's flashcards: every card in the deck turned
//   - completed the day's quiz
// One is enough. The goal is meant to be small enough to do on a bad day;
// a streak that asks for an hour gets broken, and a broken streak is where
// people quit.
//
// Forgiving on purpose, with streak freezes. Everyone holds up to two. A
// missed day spends one automatically — nothing to buy or remember — and
// every seven days kept earns one back, never more than two held. A miss
// with none left ends the streak. A freeze keeps the streak alive but does
// not add to it: the count is days actually kept.
//
// Days are the reader's local calendar days, as the client sends them —
// the same convention the quiz, the deck and the review dates use. They come
// from three records that already exist, so there is nothing new to keep in
// step: the note_review event's `day`, quizzes.completed_at, and the deck's
// per-card turnedAt.
//
// Graduation: a new account whose streak reaches three is approved, by the
// streak, and gets the free plan's limits (plans.ts). That replaced waiting
// for the owner to approve people by hand, which nothing prompted any more
// once new accounts could use the app. The account must also be two days
// old — a local day is the client's word, and without a floor on real time a
// script could claim three days in one sitting.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

export const GRADUATION_STREAK = 3
const GRADUATION_MIN_AGE_HOURS = 48
/** Freezes a reader can hold at once, and starts with. */
export const MAX_FREEZES = 2
/** Days kept that earn one freeze back. */
const DAYS_PER_FREEZE = 7
/** How far back to look. A streak longer than this reads as this long. */
const LOOKBACK_DAYS = 180

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function shift(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

/** Every local day on which the goal was met, as YYYY-MM-DD. */
export async function goalDays(userId: string): Promise<Set<string>> {
  const r = await db.execute(sql`
    -- A new note: the first day each note was ever finished.
    SELECT min(metadata->>'day') AS day
    FROM usage_events
    WHERE user_id = ${userId} AND event_type = 'note_review'
      AND metadata->>'day' ~ '^\\d{4}-\\d{2}-\\d{2}$'
    GROUP BY metadata->>'path'
    UNION
    SELECT day FROM quizzes
    WHERE user_id = ${userId} AND completed_at IS NOT NULL
    UNION
    SELECT day FROM flashcard_decks
    WHERE user_id = ${userId}
      AND jsonb_array_length(cards) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(cards) c WHERE c->>'turnedAt' IS NULL
      )
  `)
  return new Set(
    (r.rows as { day: string | null }[]).map((x) => x.day ?? '').filter((d) => DAY_RE.test(d)),
  )
}

export interface Streak {
  /** Days kept in the current streak. Freezes bridge it but do not count. */
  days: number
  /** Whether today's goal is done. Until it is, the streak stands on
   *  yesterday — not doing it yet today is not breaking it. */
  todayDone: boolean
  /** Freezes held now, 0..MAX_FREEZES. */
  freezes: number
  /** Days in the current streak that a freeze covered, oldest first. */
  frozen: string[]
}

/** The streak as of `today`, from the set of days the goal was met. Pure,
 *  so the rules above can be read in one place and tested without a DB.
 *
 *  Replayed forward from the first day in the lookback, because freezes are
 *  a balance: what is held today depends on every miss and every week kept
 *  before it, in order. */
export function computeStreak(done: Set<string>, today: string): Streak {
  const todayDone = done.has(today)
  const from = shift(today, -LOOKBACK_DAYS)
  let days = 0
  let freezes = MAX_FREEZES
  let keptTowardFreeze = 0
  let frozen: string[] = []
  // Up to yesterday; today is only counted if done — not done *yet* is not
  // a miss.
  for (let d = from; d < today; d = shift(d, 1)) {
    if (done.has(d)) {
      days++
      if (++keptTowardFreeze === DAYS_PER_FREEZE) {
        freezes = Math.min(MAX_FREEZES, freezes + 1)
        keptTowardFreeze = 0
      }
    } else if (days === 0) {
      // No streak to protect; a freeze is not spent on nothing.
    } else if (freezes > 0) {
      freezes--
      frozen.push(d)
    } else {
      days = 0
      keptTowardFreeze = 0
      frozen = []
    }
  }
  if (todayDone) {
    days++
    if (++keptTowardFreeze === DAYS_PER_FREEZE) freezes = Math.min(MAX_FREEZES, freezes + 1)
  }
  return { days, todayDone, freezes, frozen }
}

export async function streakFor(userId: string, today: string): Promise<Streak> {
  return computeStreak(await goalDays(userId), today)
}

/**
 * Approve a new account whose streak has reached GRADUATION_STREAK.
 *
 * Called after each of the three goal actions, fire-and-forget: it is a
 * consequence of what the reader did, never a reason for that to fail. Cheap
 * when there is nothing to do — one indexed read of the user row. True only
 * on the call that did the graduating.
 */
export async function maybeGraduate(userId: string, today: string): Promise<boolean> {
  try {
    if (!DAY_RE.test(today)) return false
    const [u] = await db
      .select({ approved: users.accessApproved, role: users.role, revokedAt: users.accessRevokedAt, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!u || u.approved || u.role === 'owner' || u.revokedAt) return false
    if (Date.now() - u.createdAt.getTime() < GRADUATION_MIN_AGE_HOURS * 3_600_000) return false
    const { days } = await streakFor(userId, today)
    if (days < GRADUATION_STREAK) return false
    const done = await db
      .update(users)
      .set({ accessApproved: true, accessApprovedAt: new Date(), accessApprovedBy: 'streak' })
      // Re-checked in the write, so an owner revoking in the meantime wins.
      .where(and(eq(users.id, userId), eq(users.accessApproved, false), isNull(users.accessRevokedAt)))
      .returning({ id: users.id })
    if (done.length) console.log(`[streak] ${userId} graduated on a ${days}-day streak`)
    return done.length > 0
  } catch (err) {
    console.error('[streak] graduation check failed', err)
    return false
  }
}
