// Turning a vault into a five-question quiz.
//
// The questions come from the `## Questions` section of notes the user has
// actually reviewed — asking someone about a note they have never opened
// tests the generator, not them. Those questions are open-ended prose
// ("Why do deep-sea animals have gelatinous bodies rather than skeletons?"),
// so the one thing that has to be generated is the four options and which of
// them is right.
//
// One model call for the whole quiz, not one per question. Five calls would
// be five times the latency and five times the rate-limit budget for an
// answer that is better when the model can see all five at once and avoid
// repeating itself.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import type { QuizQuestionRow } from '../db/schema.js'
import { SPACE_ROOT, spaceOf, archivedSpaces } from '../vault/spaces.js'
import { frontmatterValue } from '../vault/frontmatter.js'
import { meteredGeminiCall } from '../llm/meter.js'

export const QUIZ_LENGTH = 5
export const OPTION_COUNT = 4

function sectionOf(raw: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'im')
  const m = raw.match(re)
  if (!m || m.index == null) return ''
  const rest = raw.slice(m.index + m[0].length)
  const next = rest.search(/^##\s+/m)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

/** The questions a note offers.
 *
 *  Two shapes live under this heading and both count: the bullets the
 *  generator writes, and the `Q:` blocks Ask AI appends. Reading only one of
 *  them is the bug that has kept this section inert — Sync looks for `Q:`
 *  and therefore sees nothing on a generated vault. */
export function questionsOf(raw: string): string[] {
  const sec = sectionOf(raw, 'Questions')
  if (!sec) return []
  const out: string[] = []
  for (const line of sec.split('\n')) {
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/)
    if (bullet) {
      out.push(bullet[1])
      continue
    }
    const q = line.match(/^\s*Q\s*:\s*(.+?)\s*$/i)
    if (q) out.push(q[1])
  }
  return out.filter((q) => q.length > 12 && q.length < 400)
}

export interface Candidate {
  notePath: string
  noteTitle: string
  question: string
  /** The note's own prose, so the options can be grounded in what it says
   *  rather than in whatever the model happens to know about the topic. */
  context: string
}

function titleOf(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

/** Every question from every reviewed topic note in this vault. */
export async function collectCandidates(vaultId: string): Promise<Candidate[]> {
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}%/Topics/%`)))

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
    const context = sectionOf(r.content, 'AI Notes').slice(0, 1400)
    if (!context) continue
    for (const question of questionsOf(r.content)) {
      out.push({ notePath: r.path, noteTitle: titleOf(r.path), question, context })
    }
  }
  return out
}

/** Fisher-Yates. Array.sort(() => Math.random() - 0.5) is not a shuffle —
 *  it is biased and, with some comparison sorts, not even a permutation. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Pick the questions for one quiz: random, but spread across notes.
 *
 * A straight random draw over every question would happily return three from
 * the same note, because a note contributes three. Taking one per note first
 * and only then filling from the remainder makes a five-question quiz cover
 * five topics whenever the vault has five to cover.
 */
export function pickQuestions(all: Candidate[], n = QUIZ_LENGTH): Candidate[] {
  const byNote = new Map<string, Candidate[]>()
  for (const c of shuffle(all)) {
    const list = byNote.get(c.notePath) ?? []
    list.push(c)
    byNote.set(c.notePath, list)
  }
  const firsts: Candidate[] = []
  const rest: Candidate[] = []
  for (const list of shuffle([...byNote.values()])) {
    firsts.push(list[0])
    rest.push(...list.slice(1))
  }
  return [...firsts, ...shuffle(rest)].slice(0, n)
}

const SYSTEM = `You turn open-ended study questions into multiple-choice questions.

Rules:
- Respond with ONLY a JSON array. No markdown fences, no prose before or after.
- One object per input question, in the same order, shaped exactly:
  { "question": string, "options": [string, string, string, string], "answer": number }
- "question" may be a lightly reworded version of the input so that it has a
  single definite answer. Keep the subject identical.
- "options" must be exactly 4. "answer" is the 0-based index of the correct one.
- The correct option must be supported by the supplied note text. Do not rely
  on outside knowledge the note does not contain.
- The three wrong options must be plausible and about the same topic — not
  obviously silly, not jokes, and not simply the opposite of the right answer.
- Keep every option to one short sentence or phrase, and to a similar length,
  so the longest one is not a giveaway.
- Order does not matter; the options are shuffled before anybody sees them.`

interface RawMcq {
  question?: unknown
  options?: unknown
  answer?: unknown
}

/** Strip a ```json fence if the model added one despite being asked not to. */
function stripFence(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1].trim() : t
}

/**
 * Generate the options. Returns only questions that came back well-formed —
 * a malformed one is dropped rather than repaired, because a quiz question
 * with a guessed answer is worse than a shorter quiz.
 */
export async function buildQuestions(picks: Candidate[], userId: string): Promise<QuizQuestionRow[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Quizzes need a model key, which is not configured.')

  const user = picks
    .map(
      (p, i) =>
        `### Question ${i + 1}\nTopic: ${p.noteTitle}\nQuestion: ${p.question}\n\nNote text:\n${p.context}`,
    )
    .join('\n\n')

  const raw = await meteredGeminiCall(apiKey, SYSTEM, user, { userId, source: 'quiz-build' })
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new Error('The model returned something that was not a quiz. Try again in a moment.')
  }
  if (!Array.isArray(parsed)) throw new Error('The model returned something that was not a quiz. Try again in a moment.')

  const out: QuizQuestionRow[] = []
  parsed.forEach((item: RawMcq, i) => {
    const source = picks[i]
    if (!source) return
    const options = Array.isArray(item.options) ? item.options.filter((o): o is string => typeof o === 'string') : []
    const answer = typeof item.answer === 'number' ? item.answer : NaN
    const question = typeof item.question === 'string' && item.question.trim() ? item.question.trim() : source.question
    if (options.length !== OPTION_COUNT) return
    if (!Number.isInteger(answer) || answer < 0 || answer >= OPTION_COUNT) return
    // Duplicate options would make two taps both "right" to a reader and
    // only one right to the scorer.
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== OPTION_COUNT) return
    // Shuffle here rather than asking the model to vary the position.
    // Asked to "vary which index is correct", it returned A five times out
    // of five — a quiz you can score 5/5 on by tapping the first option
    // without reading. Permuting after the fact is deterministic, costs
    // nothing, and cannot be ignored.
    const order = shuffle([0, 1, 2, 3])
    out.push({
      notePath: source.notePath,
      noteTitle: source.noteTitle,
      question,
      options: order.map((i) => options[i]),
      answer: order.indexOf(answer),
      chosen: null,
    })
  })
  return out
}
