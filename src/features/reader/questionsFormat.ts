// Reading the `## Questions` section for display.
//
// Named questionsFormat rather than questions because Questions.tsx sits
// beside it, and two files differing only in case are the same file on a
// case-insensitive filesystem — which is most of them.
//
// The matching writer is backend/src/notes/questions.ts, which owns every
// change to this section because answering costs a model call and custom
// questions are rate-limited. This file only parses, and the grammar here
// has to stay in step with that one — they are two readers of one shape,
// not two implementations of one rule.
//
// Two shapes exist in the wild: the generator's `- bullets` and the
// `Q:`/`A:` blocks that Ask AI, Sync and now this feature write. Both are
// read; only the second is ever written.

export interface ReaderQuestion {
  question: string
  answer: string | null
}

export function questionsSection(body: string): { start: number; end: number; text: string } | null {
  const m = body.match(/(^|\n)##\s+Questions[^\n]*\n/i)
  if (!m || m.index == null) return null
  const start = m.index + m[0].length
  const rest = body.slice(start)
  const next = rest.search(/\n##\s+/)
  const end = next < 0 ? body.length : start + next
  return { start, end, text: body.slice(start, end) }
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

export function parseQuestions(body: string): ReaderQuestion[] {
  const sec = questionsSection(body)
  if (!sec) return []
  const out: ReaderQuestion[] = []
  for (const b of blocksOf(sec.text)) {
    const q = b.match(/^\s*Q\s*:\s*([\s\S]*?)(?:\n\s*A\s*:|$)/i)
    const bullet = b.match(/^\s*[-*]\s+([\s\S]*)$/)
    const question = (q?.[1] ?? bullet?.[1] ?? '').trim().replace(/\s*\n\s*/g, ' ')
    if (!question) continue
    const am = b.match(/\n\s*A\s*:\s*([\s\S]*)$/i)
    const answer = am?.[1].trim() ?? ''
    out.push({ question, answer: answer && !/^\(?awaiting answer\)?$/i.test(answer) ? answer : null })
  }
  return out
}
