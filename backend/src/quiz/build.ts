// Turning a vault into a five-question quiz.
//
// No model is involved when a quiz is built. Each note carries its own
// multiple-choice options (notes/study.ts), written when the note was: the
// right answer and three wrong ones for each of its questions. Building a
// quiz is choosing which questions, spread across notes, and shuffling the
// options — both seeded, so the same reviews on the same day give the same
// quiz. It used to be one model call per quiz, which made a daily habit
// depend on a model being fast.
//
// Only questions from notes the user has actually reviewed — asking someone
// about a note they have never opened tests the generator, not them.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import type { QuizQuestionRow } from '../db/schema.js'
import { SPACE_ROOT, spaceOf, archivedSpaces } from '../vault/spaces.js'
import { NOT_HIDDEN } from '../vault/hidden.js'
import { frontmatterValue } from '../vault/frontmatter.js'
import { quizOf } from '../notes/study.js'
import type { Rng } from '../util/seeded.js'

export const QUIZ_LENGTH = 5
export const OPTION_COUNT = 4

export interface Candidate {
  notePath: string
  noteTitle: string
  /** The question as the quiz asks it. */
  question: string
  correct: string
  wrong: string[]
}

function titleOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

/** Every stored question from every reviewed topic note in this vault. */
export async function collectCandidates(vaultId: string): Promise<Candidate[]> {
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    // A quiz must not ask about a note the reader has never been shown.
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}%/Topics/%`), NOT_HIDDEN))

  // An archived collection is one the reader has set aside. Testing them on
  // it would be the app disagreeing with a decision they just made.
  const archived = await archivedSpaces(vaultId)

  const out: Candidate[] = []
  for (const r of rows) {
    const space = spaceOf(r.path)
    if (space && archived.has(space)) continue
    // Reviewed only. `last_reviewed` is the same test the ranking and the
    // review control use, so "studied" means one thing across the app.
    if (!frontmatterValue(r.content, 'last_reviewed')) continue
    for (const q of quizOf(r.content)) {
      out.push({ notePath: r.path, noteTitle: titleOf(r.path), question: q.stem, correct: q.correct, wrong: q.wrong })
    }
  }
  return out
}

/** Fisher-Yates. Array.sort(() => Math.random() - 0.5) is not a shuffle —
 *  it is biased and, with some comparison sorts, not even a permutation. */
function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Pick the questions for one quiz: spread across notes.
 *
 * A straight draw over every question would happily return three from the
 * same note, because a note contributes three. Taking one per note first and
 * only then filling from the remainder makes a five-question quiz cover five
 * topics whenever the vault has five to cover.
 */
export function pickQuestions(all: Candidate[], rng: Rng, n = QUIZ_LENGTH): Candidate[] {
  const byNote = new Map<string, Candidate[]>()
  for (const c of shuffle(all, rng)) {
    const list = byNote.get(c.notePath) ?? []
    list.push(c)
    byNote.set(c.notePath, list)
  }
  const firsts: Candidate[] = []
  const rest: Candidate[] = []
  for (const list of shuffle([...byNote.values()], rng)) {
    firsts.push(list[0])
    rest.push(...list.slice(1))
  }
  return [...firsts, ...shuffle(rest, rng)].slice(0, n)
}

/**
 * Lay the picked questions out as a quiz: the right answer among the wrong
 * ones, in a shuffled position.
 *
 * Shuffled here rather than asking a model to vary the position. Asked to
 * "vary which index is correct", it returned A five times out of five — a
 * quiz you can score 5/5 on by tapping the first option without reading.
 */
export function buildQuestions(picks: Candidate[], rng: Rng): QuizQuestionRow[] {
  return picks.map((p) => {
    const options = [p.correct, ...p.wrong]
    const order = shuffle([0, 1, 2, 3], rng)
    return {
      notePath: p.notePath,
      noteTitle: p.noteTitle,
      question: p.question,
      options: order.map((i) => options[i]),
      answer: order.indexOf(0),
      chosen: null,
    }
  })
}
