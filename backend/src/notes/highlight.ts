// Highlight a phrase in a note, get a new note on it.
//
// The reader selects a few words in a note's AI Notes — a term they want to
// know more about — and this turns those words into a link to a new topic
// note in the same collection, written the way grown notes are (a
// placeholder now, the body from the draft queue a few seconds later).
//
// One model call, to name the new topic from the phrase and the note around
// it ("loss aversion" in a note on behavioural finance becomes "Loss
// Aversion", with a summary of what to cover). If that call fails the phrase
// itself becomes the title, so a model having a bad afternoon never costs the
// reader the link.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { meteredGeminiCall } from '../llm/meter.js'
import { buildTopicNote, sanitizeSegment } from '../onboarding/notePlan.js'
import { enqueueDrafts } from '../onboarding/queue.js'
import { SPACE_ROOT } from '../vault/spaces.js'
import { contextOfNote } from './study.js'

export const MAX_HIGHLIGHT_WORDS = 12

// ── finding the phrase in the note ───────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Where the AI Notes section's text sits in the raw note. */
function aiNotesRange(raw: string): { start: number; end: number } | null {
  const m = raw.match(/^##\s+AI Notes[^\n]*\n/m)
  if (!m || m.index == null) return null
  const start = m.index + m[0].length
  const next = raw.slice(start).search(/^##\s+/m)
  return { start, end: next === -1 ? raw.length : start + next }
}

/**
 * Find the highlighted words in the raw markdown of the note's AI Notes.
 *
 * What the reader selected is rendered text: no `**`, no `_`, and
 * line-wrapping turned into spaces. So the words are matched in order with
 * any run of whitespace or emphasis markers allowed between them. A span
 * that is already a link, or crosses into one, is not offered: a link
 * inside a link is not something markdown can draw.
 */
export function findPhrase(raw: string, phrase: string): { start: number; end: number } | null {
  const range = aiNotesRange(raw)
  if (!range) return null
  const words = phrase.split(/\s+/).filter(Boolean).map((w) => escapeRe(w.replace(/[*_`]/g, '')))
  if (!words.length) return null
  const re = new RegExp(words.join('[\\s*_`]+'), 'i')
  const section = raw.slice(range.start, range.end)
  const m = re.exec(section)
  if (!m) return null
  const start = range.start + m.index
  const end = start + m[0].length
  // Inside an existing [[...]] or [..](..)?
  const before = raw.slice(range.start, start)
  const openWiki = before.lastIndexOf('[[') > before.lastIndexOf(']]')
  const openMd = before.lastIndexOf('[') > before.lastIndexOf(']')
  if (openWiki || openMd || /\[|\]/.test(m[0])) return null
  return { start, end }
}

/** Replace the span with a link to `title`, shown as the words the reader
 *  picked. Emphasis inside the span is dropped: a link cannot hold it. */
export function linkPhrase(raw: string, span: { start: number; end: number }, title: string): string {
  const shown = raw.slice(span.start, span.end).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  const link = shown.toLowerCase() === title.toLowerCase() ? `[[${title}]]` : `[[${title}|${shown}]]`
  return raw.slice(0, span.start) + link + raw.slice(span.end)
}

// ── naming the new topic (the one model call) ────────────────────────────

const NAME_SYSTEM = `A reader highlighted a phrase in a study note because they want a separate note on it.
Name that note and say what it should cover.

Respond with ONLY a JSON object, no prose and no code fences:
{"title": string, "summary": string}

- "title": the concept the phrase refers to, 1 to 5 words, Title Case, as a topic heading (e.g. "Loss Aversion", "Mitochondrial DNA"). Not a sentence, not a question.
- "summary": 1 to 2 sentences on what the new note should explain, in the context of the subject.`

function titleCase(s: string): string {
  const small = new Set(['of', 'and', 'the', 'in', 'on', 'for', 'to', 'a', 'an', 'vs'])
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

function stripFence(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1].trim() : t
}

export async function nameTopic(
  phrase: string,
  noteTitle: string,
  space: string,
  raw: string,
  userId: string,
): Promise<{ title: string; summary: string }> {
  const fallback = {
    title: titleCase(phrase.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim()).slice(0, 60),
    summary: `${phrase}, as it comes up in ${noteTitle} (${space}).`,
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fallback
  try {
    const out = await meteredGeminiCall(
      apiKey,
      NAME_SYSTEM,
      `Subject: ${space}\nNote: ${noteTitle}\nHighlighted phrase: "${phrase}"\n\nNote text:\n${contextOfNote(raw).slice(0, 1200)}`,
      { userId, source: 'highlight-name' },
    )
    const parsed = JSON.parse(stripFence(out)) as { title?: unknown; summary?: unknown }
    const title = typeof parsed.title === 'string' ? parsed.title.replace(/[[\]|#]/g, '').trim() : ''
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    if (!title || title.length > 60 || title.split(/\s+/).length > 6) return fallback
    return { title, summary: summary || fallback.summary }
  } catch {
    return fallback
  }
}

// ── creating the note ─────────────────────────────────────────────────────

/** The note in this collection with this title, if there is one. Matched on
 *  the file name, which is what a [[wikilink]] resolves by. */
export async function existingTopic(vaultId: string, space: string, title: string): Promise<string | null> {
  const rows = await db
    .select({ path: notes.path })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}${space}/%`)))
  const want = title.toLowerCase()
  return rows.find((r) => (r.path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase() === want)?.path ?? null
}

/** Write the placeholder and queue its draft. Shown at once, not held back
 *  in the hidden buffer the way grown notes are: the reader asked for this
 *  one by name. */
export async function createTopic(o: {
  userId: string
  vaultId: string
  space: string
  title: string
  summary: string
  fromTitle: string
}): Promise<string> {
  const segment = sanitizeSegment(o.title, 60, 'Topic')
  const path = `${SPACE_ROOT}${o.space}/Topics/${segment}.md`
  const content = buildTopicNote(
    o.title,
    { title: o.title, summary: o.summary, prerequisites: [o.fromTitle], interest: 4 },
    null,
    { pending: true },
  )
  await db
    .insert(notes)
    .values({ vaultId: o.vaultId, path, content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
    .onConflictDoNothing({ target: [notes.vaultId, notes.path] })
  await enqueueDrafts([
    {
      userId: o.userId,
      vaultId: o.vaultId,
      path,
      space: o.space,
      title: o.title,
      summary: o.summary,
      siblings: [o.fromTitle],
      source: 'highlight',
    },
  ])
  return path
}
