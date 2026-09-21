// Turning a vault into one day's deck of flashcards.
//
// Unlike the quiz, there is no section in a note that already holds the
// material: generated notes have `## AI Notes` prose and nothing that says
// "these are the terms". So the terms and their definitions are extracted,
// in one model call for the whole deck — the same trade the quiz makes, and
// for the same reasons. Ten calls would be ten times the latency and ten
// times the rate-limit budget for a worse result, because a model that sees
// the whole set at once does not define the same idea twice.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import type { FlashcardRow } from '../db/schema.js'
import { SPACE_ROOT } from '../vault/spaces.js'
import { frontmatterValue, frontmatterNumber } from '../vault/frontmatter.js'
import { meteredGeminiCall } from '../llm/meter.js'

/** The free plan's daily deck.
 *
 *  One number, in one place, because a limit that lives at the call site is
 *  a limit that disagrees with the copy describing it. When tiers arrive
 *  this becomes a lookup on the plan and nothing else moves; until then
 *  every account is on the free plan and gets the same ten.
 */
const DAILY_CARDS_BY_PLAN: Record<string, number> = { free: 10 }
const DEFAULT_DAILY_CARDS = 10

export function cardsPerDay(planTier?: string | null): number {
  return DAILY_CARDS_BY_PLAN[planTier ?? 'free'] ?? DEFAULT_DAILY_CARDS
}

/** How many notes the extraction call is shown. Enough that ten cards can be
 *  spread across topics, few enough that the prompt stays inside a sensible
 *  size and the call inside its deadline.
 *
 *  Was six, which dealt eight cards on the first live run: notes vary in how
 *  much definable material they hold, some get skipped, and the validation
 *  below drops more. The pool has to be comfortably larger than the deck or
 *  the weighting has nothing to choose between and the deck comes up short. */
const NOTES_PER_CALL = 8

/** Asked for per note. An upper bound, not a target — a note with two real
 *  terms should give two, not two and a padded third. */
const TERMS_PER_NOTE = 4

// Weights for which notes a card is most worth having.
//
// Confidence dominates, and it is the *gap* to mastery that counts, not the
// score itself: flashcards are for the material that has not stuck, and a
// note at 5/5 has nothing left to drill. Importance and interest break the
// ties — what matters to the subject, and what the reader said they wanted
// more of. The same three dials the review list sorts by, weighted for a
// different question.
const W_CONFIDENCE_GAP = 2
const W_IMPORTANCE = 1
const W_INTEREST = 0.5
const MAX_CONFIDENCE = 5

export interface NoteSource {
  notePath: string
  noteTitle: string
  /** The note's own prose. Definitions have to come from what it says, not
   *  from what the model knows about the title. */
  context: string
  weight: number
}

function sectionOf(raw: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'im')
  const m = raw.match(re)
  if (!m || m.index == null) return ''
  const rest = raw.slice(m.index + m[0].length)
  const next = rest.search(/^##\s+/m)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

function titleOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

/** Fisher-Yates. `sort(() => Math.random() - 0.5)` is not a shuffle. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
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
 */
function weightedSample<T>(items: T[], weightOf: (x: T) => number, k: number): T[] {
  return items
    .map((x) => ({ x, key: Math.random() ** (1 / Math.max(weightOf(x), 0.0001)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map((e) => e.x)
}

/** Every reviewed topic note that has prose to draw from, with its weight. */
export async function collectSources(vaultId: string): Promise<NoteSource[]> {
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}%/Topics/%`)))

  const out: NoteSource[] = []
  for (const r of rows) {
    // Reviewed only — the same `last_reviewed` test the ranking, the review
    // control and the quiz use. Drilling a note nobody has read is testing
    // the generator.
    if (!frontmatterValue(r.content, 'last_reviewed')) continue
    const context = sectionOf(r.content, 'AI Notes').slice(0, 1600)
    if (context.length < 200) continue

    const confidence = frontmatterNumber(r.content, 'confidence', 0)
    const importance = frontmatterNumber(r.content, 'importance', 3)
    const interest = frontmatterNumber(r.content, 'interest', 3)
    out.push({
      notePath: r.path,
      noteTitle: titleOf(r.path),
      context,
      weight:
        (MAX_CONFIDENCE - confidence) * W_CONFIDENCE_GAP +
        importance * W_IMPORTANCE +
        interest * W_INTEREST,
    })
  }
  return out
}

/** Which notes today's deck is drawn from. */
export function pickSources(all: NoteSource[], n = NOTES_PER_CALL): NoteSource[] {
  return weightedSample(all, (s) => s.weight, n)
}

function systemPrompt(want: number): string {
  return `You extract flashcard material from study notes.

Rules:
- Respond with ONLY a JSON array. No markdown fences, no prose before or after.
- One object per term, shaped exactly:
  { "note": number, "term": string, "definition": string }
- "note" is the number of the note the term came from, as labelled in the input.
- Extract up to ${TERMS_PER_NOTE} terms per note: the ones a learner would need
  to know to understand the note, not every noun in it.
- "term" is a word or short phrase as the note uses it. Never a sentence, never
  a question, and never the note's own title.
- "definition" is one sentence, 8 to 30 words, saying what the term means.
  It must be supported by the note text — do not add outside knowledge.
- The definition must stand on its own: it must not contain the term itself,
  or an obvious inflection of it, because the reader may be shown the
  definition first and asked to recall the term.
- Skip a note entirely rather than inventing terms if it has no real ones.
- Aim for at least ${want} terms in total across all the notes. Spread them:
  take from every note that has real terms rather than exhausting the first.`
}

interface RawTerm {
  note?: unknown
  term?: unknown
  definition?: unknown
}

function stripFence(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1].trim() : t
}

/** A definition that contains its own term gives the answer away in the
 *  direction that matters most. Checked on the stem so "chemosynthesis"
 *  still catches "chemosynthetic". */
function givesItselfAway(term: string, definition: string): boolean {
  const stem = term.toLowerCase().replace(/[^a-z\s]/g, '').trim().slice(0, Math.max(4, term.length - 3))
  if (stem.length < 4) return false
  return definition.toLowerCase().includes(stem)
}

interface Extracted {
  source: NoteSource
  term: string
  definition: string
}

/**
 * One model call for the whole deck. Returns the pool of usable pairs; a
 * malformed or self-revealing one is dropped rather than repaired, because a
 * flashcard whose answer is printed on the question is worse than a shorter
 * deck.
 */
export async function extractTerms(
  picks: NoteSource[],
  userId: string,
  /** The deck size this pool has to fill. Told to the model, because asking
   *  for "up to N per note" and hoping the arithmetic works out is how the
   *  first live run produced eight cards for a ten-card deck. */
  want: number,
): Promise<Extracted[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Flashcards need a model key, which is not configured.')

  const user = picks
    .map((p, i) => `### Note ${i + 1}: ${p.noteTitle}\n\n${p.context}`)
    .join('\n\n')

  // Asked for half as many again as the deck needs: validation below drops
  // the malformed and the self-revealing, and a pool exactly the size of the
  // deck makes the weighting decorative.
  const raw = await meteredGeminiCall(apiKey, systemPrompt(Math.ceil(want * 1.5)), user, {
    userId,
    source: 'flashcards-build',
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new Error('The model returned something that was not a set of cards. Try again in a moment.')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('The model returned something that was not a set of cards. Try again in a moment.')
  }

  const seen = new Set<string>()
  const out: Extracted[] = []
  for (const item of parsed as RawTerm[]) {
    const idx = typeof item.note === 'number' ? item.note - 1 : NaN
    const source = picks[idx]
    if (!source) continue
    const term = typeof item.term === 'string' ? item.term.trim() : ''
    const definition = typeof item.definition === 'string' ? item.definition.trim() : ''
    if (term.length < 2 || term.length > 60) continue
    if (definition.length < 20 || definition.length > 320) continue
    // A "term" that is really a sentence makes a card with two answers.
    if (term.split(/\s+/).length > 5 || /[.?]$/.test(term)) continue
    // The note's own title makes a card that asks you to name the thing you
    // are already looking at. Plural-insensitive, because "Confidence
    // Intervals" and "confidence interval" are the same miss.
    const bare = (x: string) => x.toLowerCase().replace(/s$/, '')
    if (bare(term) === bare(source.noteTitle)) continue
    if (givesItselfAway(term, definition)) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ source, term, definition })
  }
  return out
}

/**
 * Deal the day's deck from the pool.
 *
 * Two things are being balanced. The cards are weighted by their note, so
 * the shakiest material comes up most; and the sides are balanced rather
 * than flipped independently, because ten coin tosses land all-one-way often
 * enough to matter — the same reason the quiz shuffles its options instead
 * of asking the model to vary them.
 */
export function dealDeck(pool: Extracted[], size: number): FlashcardRow[] {
  const chosen = weightedSample(pool, (e) => e.source.weight, size)
  const half = Math.ceil(chosen.length / 2)
  const faces = shuffle([
    ...Array<'term'>(half).fill('term'),
    ...Array<'definition'>(chosen.length - half).fill('definition'),
  ])
  return chosen.map((e, i) => ({
    notePath: e.source.notePath,
    noteTitle: e.source.noteTitle,
    term: e.term,
    definition: e.definition,
    front: faces[i],
  }))
}
