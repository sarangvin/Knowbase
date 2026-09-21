// One deck of flashcards a day, drawn from the notes you have reviewed.
//
// The server owns the deck: which terms, which way round each card starts,
// and how many there are. Same reasoning as the quiz — a deck that reshuffles
// on reload is not the deck you were given, and a daily limit the client
// enforces is not a limit.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { flashcardDecks } from '../db/schema.js'
import type { FlashcardRow } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { getOrCreatePersonalVaultId } from '../vault/spaces.js'
import { collectSources, pickSources, extractTerms, dealDeck, cardsPerDay } from '../flashcards/build.js'
import { schedulesFor, recordTurn } from '../flashcards/schedule.js'

export const flashcardsRouter = Router()
flashcardsRouter.use(requireAuth)
flashcardsRouter.use(requireApproved)

/** Local date as the client keeps it, like the quiz and the review cap. */
function dayOf(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function view(row: { day: string; cards: FlashcardRow[] }) {
  return { day: row.day, cards: row.cards }
}

async function todaysRow(userId: string, day: string) {
  const [row] = await db
    .select()
    .from(flashcardDecks)
    .where(and(eq(flashcardDecks.userId, userId), eq(flashcardDecks.day, day)))
    .limit(1)
  return row ?? null
}

/** Today's deck if it has been dealt, otherwise how much material exists to
 *  deal one from. The count is what lets the empty state say "review another
 *  note" rather than "nothing here". */
flashcardsRouter.get('/today', asyncHandler(async (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) {
    res.status(400).json({ error: 'day (YYYY-MM-DD) required' })
    return
  }
  const userId = req.user!.id
  const limit = cardsPerDay(req.user!.planTier)

  const row = await todaysRow(userId, day)
  if (row) {
    res.json({ deck: view(row), notes: null, limit })
    return
  }
  const vaultId = await getOrCreatePersonalVaultId(userId)
  const sources = await collectSources(vaultId)
  res.json({ deck: null, notes: sources.length, limit })
}))

/** Deal today's deck, or hand back the one already dealt.
 *
 *  The unique index on (user, day) is the limit; this returns the existing
 *  row instead of erroring, so a second tap on Start is a no-op rather than
 *  a failure message for something that worked. */
flashcardsRouter.post('/today', asyncHandler(async (req, res) => {
  const day = dayOf(req.body?.day)
  if (!day) {
    res.status(400).json({ error: 'body.day (YYYY-MM-DD) required' })
    return
  }
  const userId = req.user!.id
  const limit = cardsPerDay(req.user!.planTier)

  const existing = await todaysRow(userId, day)
  if (existing) {
    res.json({ deck: view(existing) })
    return
  }

  const vaultId = await getOrCreatePersonalVaultId(userId)
  const sources = await collectSources(vaultId)
  if (sources.length === 0) {
    res.status(409).json({ error: 'No cards yet — review a note or two first.' })
    return
  }

  const pool = await extractTerms(pickSources(sources), userId, limit)
  if (pool.length === 0) {
    res.status(502).json({ error: 'Could not put a deck together just now. Try again in a moment.' })
    return
  }
  // What they have already turned over, so today's deck can hold those back.
  const seen = await schedulesFor(
    userId,
    pool.map((e) => ({ notePath: e.source.notePath, term: e.term })),
  )
  const cards = dealDeck(pool, limit, seen, day)

  // onConflictDoNothing then re-read: two tabs pressing Start at the same
  // moment must end up looking at the same deck, not one each.
  await db
    .insert(flashcardDecks)
    .values({ userId, day, cards })
    .onConflictDoNothing({ target: [flashcardDecks.userId, flashcardDecks.day] })
  const row = await todaysRow(userId, day)
  if (!row) {
    res.status(500).json({ error: 'Could not save the deck.' })
    return
  }
  res.json({ deck: view(row) })
}))

/** Turn a card over.
 *
 *  Recorded on the server, not counted in the browser, for two reasons: the
 *  count has to survive a reload like everything else about the deck, and a
 *  turn is what advances the spaced-repetition schedule.
 *
 *  Idempotent. Turning a card back to look again is looking again, not
 *  un-seeing it, so `turnedAt` is written once and the schedule advances
 *  once per day — the same rule as the quiz's first answer standing.
 */
flashcardsRouter.post('/turn', asyncHandler(async (req, res) => {
  const day = dayOf(req.body?.day)
  const index = Number(req.body?.index)
  if (!day || !Number.isInteger(index)) {
    res.status(400).json({ error: 'body.day and body.index required' })
    return
  }
  const userId = req.user!.id
  const row = await todaysRow(userId, day)
  if (!row) {
    res.status(404).json({ error: 'No deck for that day.' })
    return
  }
  const cards = row.cards
  const card = cards[index]
  if (!card) {
    res.status(400).json({ error: 'No such card.' })
    return
  }

  const already = card.turnedAt != null
  if (!already) {
    card.turnedAt = new Date().toISOString()
    await db.update(flashcardDecks).set({ cards }).where(eq(flashcardDecks.id, row.id))
  }

  // Outside the `if`: recordTurn is itself idempotent per day, and a deck
  // row written before this route existed has no turnedAt to go on.
  const schedule = await recordTurn(userId, card.notePath, card.term, day)

  res.json({
    alreadyTurned: already,
    turned: cards.filter((c) => c.turnedAt != null).length,
    /** When this card can come back, so the UI can say so. */
    nextDue: schedule.dueOn,
    intervalDays: schedule.intervalDays,
    reps: schedule.reps,
  })
}))
