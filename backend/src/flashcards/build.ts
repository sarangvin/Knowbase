// Turning a vault into one day's deck of flashcards.
//
// No model is involved when a deck is dealt. Each note carries its own terms
// and definitions (notes/study.ts), written when the note was, so dealing is
// reading them, weighting them, and choosing — and choosing is seeded, so the
// same reviews on the same day give the same deck. It used to be one model
// call per deck, which made a daily habit depend on a model being fast.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import type { FlashcardRow } from '../db/schema.js'
import { SPACE_ROOT, spaceOf, archivedSpaces } from '../vault/spaces.js'
import { NOT_HIDDEN } from '../vault/hidden.js'
import { frontmatterValue, frontmatterNumber } from '../vault/frontmatter.js'
import { termsOf, type StudyTerm } from '../notes/study.js'
import type { Rng } from '../util/seeded.js'
import { limitsFor } from '../plans.js'
import { scheduleKey, type CardSchedule } from './schedule.js'

/** The day's deck size for this plan. See backend/src/plans.ts — the
 *  numbers for every limit live together there, because they used to live
 *  in three files and had to be edited in step. */
export function cardsPerDay(planTier?: string | null): number {
  return limitsFor(planTier).flashcardsPerDay
}

/** At least this many notes are drawn from for a deck, so ten cards spread
 *  across topics rather than coming four at a time from two. More are drawn
 *  when the deck is bigger — see the route. */
export const NOTES_PER_DECK = 8

// Weights for which notes a card is most worth having.
//
// Confidence dominates, and it is the *gap* to mastery that counts, not the
// score itself: flashcards are for the material that has not stuck, and a
// note at 5/5 has nothing left to drill. Interest breaks the ties — what the
// reader swiped right on. The same two dials the review list sorts by,
// weighted for a different question.
const W_CONFIDENCE_GAP = 2
const W_INTEREST = 0.5
const MAX_CONFIDENCE = 5

export interface NoteSource {
  notePath: string
  noteTitle: string
  /** The terms this note carries (notes/study.ts). */
  terms: StudyTerm[]
  weight: number
}

function titleOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

/** Fisher-Yates. `sort(() => Math.random() - 0.5)` is not a shuffle. */
function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Weighted sampling without replacement (Efraimidis-Spirakis): give each item
 * the key `random ** (1 / weight)` and take the largest k.
 *
 * "Random" and "prioritised by weight" are both requirements here and they
 * pull against each other. Sorting by weight would hand out the same ten
 * cards every day until something was reviewed; a flat shuffle would ignore
 * the weights entirely. This does neither: a heavier note is likelier every
 * day without ever being certain, so the deck changes and still leans where
 * it should.
 *
 * Seeded rather than Math.random, so the choice is a function of its inputs.
 */
function weightedSample<T>(items: T[], weightOf: (x: T) => number, k: number, rng: Rng): T[] {
  return items
    .map((x) => ({ x, key: rng() ** (1 / Math.max(weightOf(x), 0.0001)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map((e) => e.x)
}

/** Every reviewed topic note that has prose to draw from, with its weight. */
export async function collectSources(vaultId: string): Promise<NoteSource[]> {
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    // A card must not come from a note the reader has never been shown.
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}%/Topics/%`), NOT_HIDDEN))

  // An archived collection is one the reader has set aside; drilling them on
  // it would be the app disagreeing with a decision they just made.
  const archived = await archivedSpaces(vaultId)

  const out: NoteSource[] = []
  for (const r of rows) {
    const space = spaceOf(r.path)
    if (space && archived.has(space)) continue
    // Reviewed only — the same `last_reviewed` test the ranking, the review
    // control and the quiz use. Drilling a note nobody has read is testing
    // the generator.
    if (!frontmatterValue(r.content, 'last_reviewed')) continue
    // A note with no stored terms has nothing to deal. That is either a note
    // not yet filled in by the backfill, or one with no real terms in it.
    const terms = termsOf(r.content)
    if (terms.length === 0) continue

    const confidence = frontmatterNumber(r.content, 'confidence', 0)
    const interest = frontmatterNumber(r.content, 'interest', 3)
    out.push({
      notePath: r.path,
      noteTitle: titleOf(r.path),
      terms,
      weight:
        (MAX_CONFIDENCE - confidence) * W_CONFIDENCE_GAP + interest * W_INTEREST,
    })
  }
  return out
}

/** Which notes today's deck is drawn from. */
export function pickSources(all: NoteSource[], n: number, rng: Rng): NoteSource[] {
  return weightedSample(all, (s) => s.weight, n, rng)
}

interface Extracted {
  source: NoteSource
  term: string
  definition: string
}

/** Every term of the chosen notes, as the pool a deck is dealt from. */
export function termPool(picks: NoteSource[]): Extracted[] {
  return picks.flatMap((source) => source.terms.map((t) => ({ source, term: t.term, definition: t.definition })))
}

/**
 * Deal the day's deck from the pool.
 *
 * Three things are being balanced.
 *
 * **Spacing comes first.** A card whose next due date is in the future is
 * held back, however heavily its note is weighted — otherwise the schedule
 * is advisory and a card turned yesterday can come back today, which is the
 * one thing it exists to prevent.
 *
 * **Unless there is nothing else.** A vault with fifteen terms and a
 * ten-card deck runs out of due cards within a week, and a deck of four is
 * a worse answer than a deck of ten with some early repeats. So a shortfall
 * is filled from the held-back cards, soonest-due first: the ones closest
 * to being ready, rather than the ones just seen.
 *
 * **Then weight and randomness**, over whatever is left, as before.
 *
 * The faces are balanced rather than flipped independently, because ten
 * coin tosses land all-one-way often enough to matter — the same reason the
 * quiz shuffles its options instead of asking the model to vary them.
 */
export function dealDeck(
  pool: Extracted[],
  size: number,
  /** What the user has already seen, from `schedulesFor`. Empty on a first
   *  deck, which is why this is allowed to be empty rather than optional —
   *  a caller that forgets it should not silently get no spacing. */
  seen: Map<string, CardSchedule>,
  today: string,
  rng: Rng,
): FlashcardRow[] {
  // Bookmarked cards are not sampled, they are taken. The user asked for
  // this one specifically; leaving it to a weighted draw would mean asking
  // to see a card sooner and then not seeing it.
  const asked: Extracted[] = []
  const ready: Extracted[] = []
  const waiting: { card: Extracted; dueOn: string }[] = []
  for (const e of pool) {
    const sched = seen.get(scheduleKey(e.source.notePath, e.term))
    if (sched?.bookmarked) asked.push(e)
    // Never seen, or due today or earlier. String comparison is correct for
    // ISO dates and is the same comparison the rest of the app makes.
    else if (!sched || sched.dueOn <= today) ready.push(e)
    else waiting.push({ card: e, dueOn: sched.dueOn })
  }

  const chosen = [
    ...asked.slice(0, size),
    ...weightedSample(ready, (e) => e.source.weight, Math.max(0, size - asked.length), rng),
  ]
  if (chosen.length < size) {
    const short = size - chosen.length
    chosen.push(
      ...waiting
        .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0))
        .slice(0, short)
        .map((w) => w.card),
    )
  }

  const half = Math.ceil(chosen.length / 2)
  const faces = shuffle([
    ...Array<'term'>(half).fill('term'),
    ...Array<'definition'>(chosen.length - half).fill('definition'),
  ], rng)
  return chosen.map((e, i) => ({
    notePath: e.source.notePath,
    noteTitle: e.source.noteTitle,
    term: e.term,
    definition: e.definition,
    front: faces[i],
    turnedAt: null,
  }))
}
