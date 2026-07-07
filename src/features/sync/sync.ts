// ─────────────────────────────────────────────────────────────────────────────
// AI Sync engine — the web equivalent of the vault's `sync-knowledge-notes`
// skill. Scans every note for work the local model can do:
//   • unanswered questions in `## Questions` (a `Q:` with no `A:`, or an
//     `A: *(awaiting answer)*` placeholder) → answer them
//   • non-empty `## My Notes` → rewrite `## AI Notes` folding the user's
//     points in
// Pure string/planning helpers live here; the modal orchestrates + saves.
// ─────────────────────────────────────────────────────────────────────────────
import type { Note } from '../../vault/types'

export interface SyncTask {
  path: string
  title: string
  kind: 'question' | 'notes'
  /** for kind=question: the question text to answer */
  question?: string
  label: string
}

interface Section {
  contentStart: number
  contentEnd: number
  text: string
}

/** Locate a `## Name` section's content span within raw markdown. */
export function extractSection(raw: string, name: string): Section | null {
  const re = new RegExp(`(^|\\n)##\\s+${name}[^\\n]*\\n`, 'i')
  const m = raw.match(re)
  if (!m || m.index == null) return null
  const contentStart = m.index + m[0].length
  const rest = raw.slice(contentStart)
  const next = rest.search(/\n##\s+/)
  const contentEnd = next < 0 ? raw.length : contentStart + next
  return { contentStart, contentEnd, text: raw.slice(contentStart, contentEnd) }
}

/** Replace a section's content (or append the section if missing). */
export function replaceSection(raw: string, name: string, newContent: string): string {
  const sec = extractSection(raw, name)
  const body = `\n${newContent.trim()}\n`
  if (sec) return raw.slice(0, sec.contentStart) + body + raw.slice(sec.contentEnd)
  const sep = raw.endsWith('\n') ? '\n' : '\n\n'
  return `${raw}${sep}## ${name}\n${body}`
}

function questionOf(block: string): string | null {
  const m = block.match(/^\s*Q\s*:\s*([\s\S]*?)(?:\nA\s*:|$)/)
  return m ? m[1].trim() : null
}

function isAnswered(block: string): boolean {
  const m = block.match(/\nA\s*:\s*([\s\S]*)/)
  if (!m) return false
  const a = m[1].trim()
  return a.length > 0 && !/awaiting answer/i.test(a)
}

/** Questions in `## Questions` that have no real answer yet. */
export function unansweredQuestions(raw: string): string[] {
  const sec = extractSection(raw, 'Questions')
  if (!sec) return []
  return sec.text
    .split(/\n(?=Q\s*:)/)
    .filter((b) => /^\s*Q\s*:/.test(b))
    .filter((b) => !isAnswered(b))
    .map(questionOf)
    .filter((q): q is string => !!q)
}

/** Write `answer` into the Q-block matching `question` (replacing any placeholder A). */
export function insertAnswer(raw: string, question: string, answer: string): string {
  const sec = extractSection(raw, 'Questions')
  if (!sec) return raw
  const blocks = sec.text.split(/\n(?=Q\s*:)/)
  const rewritten = blocks.map((b) => {
    if (questionOf(b) !== question || isAnswered(b)) return b
    const a = `A: ${answer.trim()}`
    if (/\nA\s*:/.test(b)) return b.replace(/\nA\s*:[\s\S]*$/, `\n\n${a}\n`)
    return `${b.replace(/\s*$/, '')}\n\n${a}\n`
  })
  return raw.slice(0, sec.contentStart) + rewritten.join('\n') + raw.slice(sec.contentEnd)
}

/** Non-empty user-written `## My Notes` content, if any. */
export function myNotesOf(raw: string): string {
  return extractSection(raw, 'My Notes')?.text.trim() ?? ''
}

// Dashboards, config, templates, and the quiz log are not study notes — the quiz's
// "(awaiting answer)" placeholders are for the USER to answer, not the model.
const SKIP_RE = /(^|\/)(Next Up|Today|Flashcards|Quiz|README|_config|Welcome)\.md$/i

export function planSync(notes: Note[]): SyncTask[] {
  const tasks: SyncTask[] = []
  for (const n of notes) {
    if (SKIP_RE.test(n.path) || /^Templates\//i.test(n.path)) continue
    for (const q of unansweredQuestions(n.raw)) {
      tasks.push({
        path: n.path,
        title: n.title,
        kind: 'question',
        question: q,
        label: `Answer: “${q.length > 70 ? q.slice(0, 70) + '…' : q}”`,
      })
    }
    if (myNotesOf(n.raw)) {
      tasks.push({
        path: n.path,
        title: n.title,
        kind: 'notes',
        label: 'Fold My Notes into AI Notes',
      })
    }
  }
  return tasks
}

export const AI_NOTES_SYSTEM = `You maintain the "## AI Notes" section of a topic note in a
personal knowledge base. The user has written their own rough understanding under "## My Notes".
Rewrite the AI Notes so they incorporate and refine the user's points: keep existing correct
content, integrate what the user got right, gently correct any misconceptions, and keep
[[wikilinks]] that already appear. Return ONLY the markdown body for the AI Notes section —
no "## AI Notes" heading, no preamble, no commentary.`

export function aiNotesPrompt(note: Note): string {
  const ai = extractSection(note.raw, 'AI Notes')?.text.trim() ?? '(empty)'
  const mine = myNotesOf(note.raw)
  return (
    `Note title: ${note.title}\n\n` +
    `Current AI Notes:\n${ai.slice(0, 8000)}\n\n` +
    `My Notes (user-written, to fold in):\n${mine.slice(0, 4000)}`
  )
}
