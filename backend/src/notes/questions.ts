// The `## Questions` section: reading it, answering into it, and adding to it.
//
// **The shape.** Two have existed side by side since the beginning — the
// generator writes `- bullets`, Ask AI and Sync write `Q:` / `A:` blocks —
// and that split is why the section has never done anything. Sync looks for
// `Q:` and finds nothing on a generated note; the quiz had to learn to read
// both. This file reads both and always *writes* the `Q:`/`A:` shape, so a
// question converts the first time it is answered and the vault converges on
// one grammar instead of two.
//
// The writer lives on the server because answering is rate-limited and costs
// a model call. src/features/reader/questionsFormat.ts is the matching reader for
// display; if this grammar changes, that file changes with it.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { meteredGeminiCall } from '../llm/meter.js'

export interface ParsedQuestion {
  question: string
  /** Null when it has been asked but not answered yet. */
  answer: string | null
}

function sectionSpan(raw: string): { start: number; end: number; text: string } | null {
  const m = raw.match(/(^|\n)##\s+Questions[^\n]*\n/i)
  if (!m || m.index == null) return null
  const start = m.index + m[0].length
  const rest = raw.slice(start)
  const next = rest.search(/\n##\s+/)
  const end = next < 0 ? raw.length : start + next
  return { start, end, text: raw.slice(start, end) }
}

/** Split a section body into blocks, one per question, in document order.
 *
 *  Mode-aware, and it has to be: once a `Q:` block opens, everything after
 *  it belongs to that block until the next `Q:` — including bullet lines,
 *  because answers contain lists. Treating every `- ` as a new question
 *  turned one answered question with three bullets into four questions, and
 *  since writing rewrites the whole section, the next answer would have
 *  reformatted that content into nonsense. Bullets only start a question
 *  while we are not inside a Q block. */
function blocksOf(text: string): string[] {
  const out: string[] = []
  let current: string[] = []
  let inQBlock = false
  const flush = () => {
    if (current.length) out.push(current.join('\n'))
    current = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*Q\s*:/i.test(line)) {
      flush()
      inQBlock = true
      current.push(line)
      continue
    }
    if (!inQBlock && /^\s*[-*]\s+\S/.test(line)) {
      flush()
      current.push(line)
      continue
    }
    if (current.length) current.push(line)
  }
  flush()
  return out.map((b) => b.replace(/\s+$/, '')).filter(Boolean)
}

function questionOf(block: string): string | null {
  const q = block.match(/^\s*Q\s*:\s*([\s\S]*?)(?:\n\s*A\s*:|$)/i)
  if (q) return q[1].trim().replace(/\s*\n\s*/g, ' ') || null
  const bullet = block.match(/^\s*[-*]\s+([\s\S]*)$/)
  if (bullet) return bullet[1].trim().replace(/\s*\n\s*/g, ' ') || null
  return null
}

function answerOf(block: string): string | null {
  const m = block.match(/\n\s*A\s*:\s*([\s\S]*)$/i)
  if (!m) return null
  const a = m[1].trim()
  // The quiz writes "(awaiting answer)" placeholders for the user to fill in;
  // those are not answers.
  if (!a || /^\(?awaiting answer\)?$/i.test(a)) return null
  return a
}

export function parseQuestions(raw: string): ParsedQuestion[] {
  const sec = sectionSpan(raw)
  if (!sec) return []
  const out: ParsedQuestion[] = []
  for (const b of blocksOf(sec.text)) {
    const question = questionOf(b)
    if (!question) continue
    out.push({ question, answer: answerOf(b) })
  }
  return out
}

/** Same normalisation both sides of a match, so "the same question" does not
 *  hinge on a trailing space or a capital letter. */
function key(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim()
}

function renderBlock(q: ParsedQuestion): string {
  return q.answer ? `Q: ${q.question}\n\nA: ${q.answer}` : `Q: ${q.question}`
}

function writeSection(raw: string, items: ParsedQuestion[]): string {
  const body = `\n${items.map(renderBlock).join('\n\n')}\n`
  const sec = sectionSpan(raw)
  if (sec) return raw.slice(0, sec.start) + body + raw.slice(sec.end)
  const sep = raw.endsWith('\n') ? '\n' : '\n\n'
  return `${raw}${sep}## Questions\n${body}`
}

/** Attach an answer to an existing question. Rewrites the whole section, so
 *  a bullet becomes a `Q:`/`A:` block the first time it is answered. */
export function setAnswer(raw: string, question: string, answer: string): string {
  const items = parseQuestions(raw)
  const k = key(question)
  if (!items.some((i) => key(i.question) === k)) return raw
  return writeSection(
    raw,
    items.map((i) => (key(i.question) === k ? { ...i, answer } : i)),
  )
}

/** Add a question the user typed. Returns null when it is already there —
 *  asking the same thing twice should not cost them their daily allowance. */
export function appendQuestion(raw: string, question: string): string | null {
  const items = parseQuestions(raw)
  const k = key(question)
  if (items.some((i) => key(i.question) === k)) return null
  return writeSection(raw, [...items, { question, answer: null }])
}

export function removeQuestion(raw: string, question: string): string {
  const items = parseQuestions(raw)
  const k = key(question)
  const kept = items.filter((i) => key(i.question) !== k)
  if (kept.length === items.length) return raw
  return writeSection(raw, kept)
}

/** The note's own prose, which is what an answer has to be grounded in. */
export function contextOf(raw: string): string {
  const m = raw.match(/(^|\n)##\s+AI Notes[^\n]*\n/i)
  if (!m || m.index == null) return ''
  const start = m.index + m[0].length
  const rest = raw.slice(start)
  const next = rest.search(/\n##\s+/)
  return (next < 0 ? rest : rest.slice(0, next)).trim().slice(0, 4000)
}

const SYSTEM = `You answer a study question about one specific note, for the person who wrote the note's collection.

Rules:
- Answer in 2-5 sentences of plain prose. No preamble, no headings, no bullet
  list unless the answer is genuinely a list of three or more things.
- Ground the answer in the supplied note text. You may add a sentence of
  standard background if the note leaves an obvious gap, but never contradict
  it and never invent specifics — numbers, names, dates — that are not there.
- If the note does not contain enough to answer, say so plainly in one
  sentence and then give the best short general answer you can.
- Write to someone who has just read the note. Do not restate the question or
  open with "Great question".`

/** Ask the model. Throws with a readable message; the route turns that into
 *  something the reader can act on. */
export async function generateAnswer(
  noteTitle: string,
  context: string,
  question: string,
  userId: string,
  source: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Answers need a model key, which is not configured.')
  const user = `Note: ${noteTitle}\n\nNote text:\n${context || '(this note has no body yet)'}\n\nQuestion: ${question}`
  const raw = await meteredGeminiCall(apiKey, SYSTEM, user, { userId, source })
  const answer = raw.trim()
  if (!answer) throw new Error('The model returned nothing. Try again in a moment.')
  return answer
}

/** Load a note from the caller's own vault. Returns null rather than
 *  throwing, so a route can 404 on a path that is not theirs without
 *  distinguishing "missing" from "someone else's". */
export async function loadOwnNote(vaultId: string, path: string) {
  const [row] = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, path)))
    .limit(1)
  return row ?? null
}

export async function writeOwnNote(vaultId: string, path: string, content: string): Promise<void> {
  await db
    .update(notes)
    .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, path)))
}
