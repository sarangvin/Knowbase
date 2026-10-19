// Coins: earned for finishing things, spent on starting new ones.
//
//   + finishing a note for the first time    3
//   + each quiz question answered right      2  (wrong: 0)
//   - starting a new collection             10
//
// Like the streak (usage/streak.ts), the balance is derived, not stored: it
// is counted from records that already exist — the first note_review event
// per note, quizzes.score (right answers; first answer stands, so it can't
// be farmed), and the collection_starts ledger. Nothing
// new to write, nothing to keep in step, and no way for a client to award
// itself coins; re-finishing a note or re-answering a quiz adds nothing
// because the records are counted once each.
//
// What a collection costs:
//   - The first one ever is free. A new account has no coins, and charging
//     for the collection that is the whole point of signing up would leave
//     them with nothing to earn coins *from*.
//   - Collections started before coins existed (COINS_FROM) are not charged
//     retroactively; nobody opens the app to find themselves in debt.
// The start route refuses a paid collection the balance cannot cover, via
// collectionAllowance (onboarding/limits.ts).
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

export const COINS_PER = { note: 3, correctAnswer: 2 } as const
export const COLLECTION_COST = 10
/** Collection starts from this moment on are paid for: when coins went
 *  live. (It was 12:00 for the first hour, which let a 11:57 start through
 *  free.) */
const COINS_FROM = '2026-10-19T11:50:00Z'

export interface Coins {
  balance: number
  notes: number
  /** Quiz questions answered right, all time. */
  correctAnswers: number
  /** Collections paid for with coins. */
  paidCollections: number
  /** What starting the next collection costs: 0 for the first ever. */
  nextCollectionCost: number
}

export async function coinsFor(userId: string): Promise<Coins> {
  const r = await db.execute(sql`
    SELECT
      (SELECT count(DISTINCT metadata->>'path')::int FROM usage_events
        WHERE user_id = ${userId} AND event_type = 'note_review'
          AND metadata->>'path' IS NOT NULL) AS notes,
      (SELECT coalesce(sum(score), 0)::int FROM quizzes
        WHERE user_id = ${userId}) AS correct,
      (SELECT count(*)::int FROM collection_starts
        WHERE user_id = ${userId}) AS started,
      (SELECT count(*)::int FROM collection_starts c
        WHERE c.user_id = ${userId} AND c.created_at >= ${COINS_FROM}::timestamptz
          AND c.id <> (SELECT f.id FROM collection_starts f WHERE f.user_id = ${userId}
                       ORDER BY f.created_at, f.id LIMIT 1)) AS paid
  `)
  const row = (r.rows[0] ?? {}) as Record<string, number | undefined>
  const notes = Number(row.notes ?? 0)
  const correctAnswers = Number(row.correct ?? 0)
  const paidCollections = Number(row.paid ?? 0)
  return {
    balance: notes * COINS_PER.note + correctAnswers * COINS_PER.correctAnswer - paidCollections * COLLECTION_COST,
    notes,
    correctAnswers,
    paidCollections,
    nextCollectionCost: Number(row.started ?? 0) > 0 ? COLLECTION_COST : 0,
  }
}
