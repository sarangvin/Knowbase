// The study material a note carries: flashcard terms and quiz options.
//
// **Why it is stored.** Both used to be generated when the reader pressed
// Start — one model call for the day's flashcards, one for the day's quiz.
// That made two daily habits depend on a model being fast: when Google's
// flash-lite models slowed to a 16s median, decks failed to build and the
// reader saw "Internal server error". It also spent quota re-reading the
// same notes every day for material that does not change. The material is a
// property of the note, so it is written once, when the note is, and dealing
// a deck or a quiz is a read.
//
// **Where it lives.** In the note, in its own last section:
//
//     ## Study data
//
//     <!-- rabbithole:study v1
//     {"terms":[...],"quiz":[...]}
//     -->
//
// In the note rather than in a table because that is where the question
// answers already live, and because it travels with the note: adopting a
// collection from the library copies it, and nothing has to know to copy a
// second thing. A heading of its own because the Questions section is
// rewritten wholesale from its heading to the next one (notes/questions.ts),
// so anything left inside it would be swallowed into the last answer. An HTML
// comment so Obsidian's reading view shows only the heading; the app strips
// the whole section before rendering (src/vault/parse.ts).
//
// **What is checked on the way out.** Edited notes drift from what was
// generated, so reading does not trust the stored data blindly: a quiz item is
// kept only while its question is still in the note, and a card only while
// its term still appears in the note's text.
import { meteredGeminiCall } from '../llm/meter.js'
import { parseQuestions } from './questions.js'

export interface StudyTerm {
  term: string
  definition: string
}

export interface StudyQuiz {
  /** The note's own question text — the key that ties this item to the
   *  question it was written for. */
  question: string
  /** The question as asked in the quiz, lightly reworded so it has one
   *  definite answer. */
  stem: string
  correct: string
  wrong: string[]
}

export interface StudyData {
  terms: StudyTerm[]
  quiz: StudyQuiz[]
}

export const STUDY_HEADING = '## Study data'
const OPEN = '<!-- rabbithole:study v1'
const SECTION_RE = /(^|\n)##[ \t]+Study data[ \t]*\n[\s\S]*?(?=\n##[ \t]+|$)/

export const OPTION_COUNT = 4
const TERMS_PER_NOTE = 4

// ── storage ──────────────────────────────────────────────────────────────

/** The stored data exactly as written, before it is checked against the
 *  note's current text. Null when the note has none, or it is unreadable. */
export function storedOf(raw: string): StudyData | null {
  const m = raw.match(SECTION_RE)
  if (!m) return null
  const open = m[0].indexOf(OPEN)
  const close = m[0].lastIndexOf('-->')
  if (open < 0 || close < open) return null
  try {
    const parsed = JSON.parse(m[0].slice(open + OPEN.length, close).trim()) as Partial<StudyData>
    return {
      terms: Array.isArray(parsed.terms) ? parsed.terms : [],
      quiz: Array.isArray(parsed.quiz) ? parsed.quiz : [],
    }
  } catch {
    return null
  }
}

/** Is there a study section at all — even an empty one. An empty one means
 *  the model was asked and found nothing usable, which is not a reason to
 *  ask again on every pass. */
export function hasStudySection(raw: string): boolean {
  return storedOf(raw) != null
}

export function stripStudy(raw: string): string {
  return raw.replace(SECTION_RE, '').replace(/\s+$/, '') + '\n'
}

/** Replace the note's study section, or add it at the end. */
export function writeStudy(raw: string, data: StudyData): string {
  // `--` cannot appear inside an HTML comment. In this JSON it can only be
  // inside a string, where - means the same thing.
  const json = JSON.stringify(data).replace(/--/g, '\\u002d\\u002d')
  return `${stripStudy(raw)}\n${STUDY_HEADING}\n\n${OPEN}\n${json}\n-->\n`
}

// ── reading, checked against the note as it is now ───────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function bodyText(raw: string): string {
  return stripStudy(raw)
}

/** Terms still worth a card: the term is still in the note. A reader who
 *  rewrote the note and removed a concept should not be drilled on it. */
export function termsOf(raw: string): StudyTerm[] {
  const stored = storedOf(raw)
  if (!stored) return []
  const text = norm(bodyText(raw))
  return cleanTerms(stored.terms, '').filter((t) => text.includes(norm(t.term)))
}

/** Quiz items whose question is still in the note. */
export function quizOf(raw: string): StudyQuiz[] {
  const stored = storedOf(raw)
  if (!stored) return []
  const live = new Set(parseQuestions(raw).map((q) => norm(q.question)))
  return cleanQuiz(stored.quiz).filter((q) => live.has(norm(q.question)))
}

// ── validation, shared by the drafter and the backfill ───────────────────

/** A definition that contains its own term gives the answer away in the
 *  direction that matters most. Checked on the stem so "chemosynthesis"
 *  still catches "chemosynthetic". */
function givesItselfAway(term: string, definition: string): boolean {
  const stem = term.toLowerCase().replace(/[^a-z\s]/g, '').trim().slice(0, Math.max(4, term.length - 3))
  if (stem.length < 4) return false
  return definition.toLowerCase().includes(stem)
}

/** Keep the well-formed terms, drop the rest. A malformed or self-revealing
 *  card is dropped rather than repaired: a flashcard whose answer is printed
 *  on the question is worse than a shorter deck. */
export function cleanTerms(items: unknown, noteTitle: string): StudyTerm[] {
  if (!Array.isArray(items)) return []
  const bare = (x: string) => x.toLowerCase().replace(/s$/, '')
  const seen = new Set<string>()
  const out: StudyTerm[] = []
  for (const item of items as { term?: unknown; definition?: unknown }[]) {
    const term = typeof item?.term === 'string' ? item.term.trim() : ''
    const definition = typeof item?.definition === 'string' ? item.definition.trim() : ''
    if (term.length < 2 || term.length > 60) continue
    if (definition.length < 20 || definition.length > 320) continue
    // A "term" that is really a sentence makes a card with two answers.
    if (term.split(/\s+/).length > 5 || /[.?]$/.test(term)) continue
    // The note's own title makes a card that asks you to name the thing you
    // are already looking at.
    if (noteTitle && bare(term) === bare(noteTitle)) continue
    if (givesItselfAway(term, definition)) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ term, definition })
    if (out.length === TERMS_PER_NOTE) break
  }
  return out
}

/** Keep the well-formed quiz items. Duplicate options would make two taps
 *  both "right" to a reader and only one right to the scorer. */
export function cleanQuiz(items: unknown): StudyQuiz[] {
  if (!Array.isArray(items)) return []
  const out: StudyQuiz[] = []
  for (const item of items as Partial<StudyQuiz>[]) {
    const question = typeof item?.question === 'string' ? item.question.trim() : ''
    const stem = typeof item?.stem === 'string' && item.stem.trim() ? item.stem.trim() : question
    const correct = typeof item?.correct === 'string' ? item.correct.trim() : ''
    const wrong = Array.isArray(item?.wrong)
      ? item.wrong.filter((w): w is string => typeof w === 'string').map((w) => w.trim())
      : []
    if (!question || !correct || wrong.length !== OPTION_COUNT - 1) continue
    const all = [correct, ...wrong]
    if (all.some((o) => !o || o.length > 220)) continue
    if (new Set(all.map(norm)).size !== OPTION_COUNT) continue
    out.push({ question, stem, correct, wrong })
  }
  return out
}

/** What a model is asked for, so the drafter and the backfill cannot drift
 *  apart on the shape. `n` is the 1-based position of the question in the
 *  note, and is what ties an item back to its question text. */
export const STUDY_SCHEMA_PROMPT = `"terms": [               // up to 4: the words or short phrases a learner needs in order to understand this note
    { "term": string,      // as the note uses it. Never a sentence, never a question, never the note's own title
      "definition": string // ONE sentence, 8 to 30 words, supported by the note text. It must not contain the term itself
    }                      // or an obvious inflection of it. Skip terms entirely rather than invent weak ones
  ],
  "quiz": [                // one per numbered question
    { "n": number,         // the question's number
      "stem": string,      // the question, lightly reworded so it has a single definite answer. Same subject
      "correct": string,   // the right answer in ONE short sentence or phrase, supported by the note text
      "wrong": [string, string, string] // three plausible wrong answers on the same topic: not jokes, not simply the
    }                      // opposite of the right one, each about the same length as the right answer
  ]`

/** Turn the model's `quiz` array into stored items, resolving each `n`
 *  against the note's question texts. */
export function quizFromModel(items: unknown, questionTexts: string[]): StudyQuiz[] {
  if (!Array.isArray(items)) return []
  const mapped = (items as { n?: unknown; stem?: unknown; correct?: unknown; wrong?: unknown }[]).map((x) => {
    const question = typeof x?.n === 'number' ? questionTexts[x.n - 1] : undefined
    return { question: question ?? '', stem: x?.stem, correct: x?.correct, wrong: x?.wrong }
  })
  return cleanQuiz(mapped)
}

// ── generating, for notes that predate this ──────────────────────────────

const SYSTEM = `You prepare study material from one study note: flashcard terms, and multiple-choice options for the note's questions.

Rules:
- Respond with ONLY a single JSON object. No markdown fences, no prose before or after.
- The object must match this shape exactly:
{
  ${STUDY_SCHEMA_PROMPT}
}
- Everything must be supported by the note text supplied. Do not add outside knowledge.
- Do not mention that you are an AI.`

function stripFence(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1].trim() : t
}

/** The prose a model is shown for a note: its AI Notes section. */
export function contextOfNote(raw: string): string {
  const m = raw.match(/^##\s+AI Notes\s*$/im)
  if (!m || m.index == null) return ''
  const rest = raw.slice(m.index + m[0].length)
  const next = rest.search(/^##\s+/m)
  return (next === -1 ? rest : rest.slice(0, next)).trim().slice(0, 1800)
}

/** One model call for one note. Returns the cleaned material — which can be
 *  empty, if the model returned nothing usable — and throws if the call
 *  itself failed, so a caller can tell "nothing there" from "could not ask". */
export async function generateStudy(
  noteTitle: string,
  raw: string,
  userId: string | undefined,
  source = 'study-backfill',
): Promise<StudyData> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('No model key configured.')
  const questions = parseQuestions(raw).map((q) => q.question)
  const user = `Note title: "${noteTitle}"

Note text:
${contextOfNote(raw)}

Questions (use the number as "n"):
${questions.length ? questions.map((q, i) => `${i + 1}. ${q}`).join('\n') : '(none)'}`

  const out = await meteredGeminiCall(apiKey, SYSTEM, user, { userId, source })
  const parsed = JSON.parse(stripFence(out)) as { terms?: unknown; quiz?: unknown }
  return {
    terms: cleanTerms(parsed.terms, noteTitle),
    quiz: quizFromModel(parsed.quiz, questions),
  }
}

/** Does this note still need study material generated? */
export function needsStudy(raw: string): boolean {
  if (contextOfNote(raw).length < 200) return false
  return !hasStudySection(raw)
}
