// Server-side completion of a new space's note drafts.
//
// This used to run in the browser after onboarding handed the user their
// vault. That worked only as long as the tab stayed open: close it, lock the
// phone, or switch apps and the remaining notes were simply never written,
// leaving a vault permanently stuck on one-line summaries with no way to
// retry. Doing it here means the work survives the client.
//
// The request returns 202 immediately and the drafting continues under
// waitUntil, so the caller never waits and a dropped connection doesn't kill
// the job.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { waitUntil } from '@vercel/functions'
import { db } from '../db/client.js'
import { notes, vaults } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { validateVaultPath, PathError } from '../vault/pathValidation.js'
import { streamGeminiChat, DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const draftNotesRouter = Router()
draftNotesRouter.use(requireAuth)
draftNotesRouter.use(requireApproved)

const MAX_DRAFTS = 12

export interface DraftRequestItem {
  path: string
  title: string
  summary: string
  /** Exact text written at creation. A note still matching this is untouched
   *  and safe to replace; anything else is the user's own writing. */
  placeholder: string
}

const NOTE_SYSTEM_PROMPT = `You are writing the first draft of a study note for someone who is about to learn a
subtopic for the first time. You will be given the overall subject, the subtopic, and the
other subtopics in their learning plan.

Rules:
- Respond with ONLY a single JSON object. No markdown code fences, no prose before or after.
- The JSON object must exactly match this shape:
{
  "overview": string,     // 2-3 short paragraphs of plain prose explaining what this subtopic
                          // is and why it matters. Markdown emphasis is fine; no headings.
  "key_points": string[], // 4-6 concrete, specific things worth knowing. Each one sentence.
  "questions": string[]   // 3 questions the learner should be able to answer once they know
                          // this. Real comprehension questions, not "what is X?".
}
- Write for a beginner: define jargon the first time you use it.
- Be concrete. Prefer a specific example or number over a general claim.
- Do NOT invent URLs, citations, book titles or paper references of any kind.
- Do not mention that you are an AI or describe what you are doing.`

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = ''
  for await (const chunk of gen) out += chunk
  return out
}

function stripFence(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1].trim() : t
}

/** Mirrors the client's sanitizer: generated prose must not invent sections
 *  beside the fixed skeleton, and a stray `---` must not read as frontmatter. */
function sanitizeBlock(md: string): string {
  return md
    .split('\n')
    .map((l) => (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ? '' : l.replace(/^(\s*)#{1,2}\s+/, '$1### ')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeInline(t: string): string {
  return t
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*/, '')
    .replace(/^\s*(?:[#>]+|[-*+]|\d+\.)\s*/, '')
    .trim()
}

/** Replaces the "## AI Notes" section of the placeholder in place. Rebuilding
 *  the whole note here would duplicate the client's frontmatter logic and let
 *  the two drift; the placeholder already has correct frontmatter, title and
 *  section skeleton, so only the body it was holding open needs filling. */
function fillPlaceholder(placeholder: string, overview: string, keyPoints: string[], questions: string[]): string {
  const ai =
    sanitizeBlock(overview) +
    (keyPoints.length ? '\n\n**Key points**\n\n' + keyPoints.map((k) => `- ${sanitizeInline(k)}`).join('\n') : '')

  let out = placeholder.replace(
    /(^## AI Notes\n\n)([\s\S]*?)(?=\n## )/m,
    (_m, head: string) => `${head}${ai}\n`,
  )
  if (questions.length) {
    out = out.replace(/(^## Questions\n\n)([\s\S]*)$/m, (_m, head: string) => {
      return `${head}${questions.map((q) => `- ${sanitizeInline(q)}`).join('\n')}\n`
    })
  }
  return out
}

async function draftOne(
  apiKey: string,
  model: string,
  space: string,
  item: DraftRequestItem,
  siblings: string[],
): Promise<string | null> {
  const others = siblings.filter((t) => t !== item.title)
  const user = `Overall subject: "${space}"
Subtopic to write about: "${item.title}"
What it should cover: ${item.summary}
${others.length ? `Other subtopics in the same plan (for context; don't duplicate them): ${others.join(', ')}` : ''}

Write the first-draft study note for "${item.title}" as specified.`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await collect(streamGeminiChat(apiKey, NOTE_SYSTEM_PROMPT, user, model))
      const parsed = JSON.parse(stripFence(raw)) as {
        overview?: unknown
        key_points?: unknown
        questions?: unknown
      }
      const overview = typeof parsed.overview === 'string' ? parsed.overview.trim() : ''
      if (!overview) continue
      const strings = (v: unknown) =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []
      return fillPlaceholder(item.placeholder, overview, strings(parsed.key_points), strings(parsed.questions))
    } catch (err) {
      console.warn(`[draft-notes] "${item.title}" attempt ${attempt + 1} failed:`, err)
    }
  }
  return null
}

draftNotesRouter.post('/', asyncHandler(async (req, res) => {
  const space = typeof req.body?.space === 'string' ? req.body.space : null
  const raw = req.body?.items
  if (!space || !Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DRAFTS) {
    res.status(400).json({ error: `body.space and body.items (1-${MAX_DRAFTS}) required` })
    return
  }

  const items: DraftRequestItem[] = []
  for (const it of raw) {
    if (
      typeof it?.path !== 'string' ||
      typeof it?.title !== 'string' ||
      typeof it?.summary !== 'string' ||
      typeof it?.placeholder !== 'string'
    ) {
      res.status(400).json({ error: 'each item needs path, title, summary, placeholder' })
      return
    }
    try {
      items.push({ ...it, path: validateVaultPath(it.path) })
    } catch (err) {
      res.status(400).json({ error: err instanceof PathError ? err.message : 'invalid path' })
      return
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // Not the user's problem and not recoverable by retrying: their notes are
    // already saved, they just keep the summaries.
    res.status(202).json({ started: 0, reason: 'llm not configured' })
    return
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const userId = req.user!.id
  const siblings = items.map((i) => i.title)

  res.status(202).json({ started: items.length })

  // After the response. waitUntil keeps the invocation alive so a client that
  // navigates away, backgrounds the tab or loses signal doesn't abort this.
  waitUntil(
    (async () => {
      const vaultRows = await db
        .select({ id: vaults.id })
        .from(vaults)
        .where(and(eq(vaults.ownerUserId, userId), eq(vaults.kind, 'personal')))
        .limit(1)
      const vaultId = vaultRows[0]?.id
      if (!vaultId) return

      // Sequential, not parallel: the free tier is rate-limited per user and
      // five concurrent calls is the fastest way to trip it. Nobody is
      // waiting on this, so latency is not the constraint it was client-side.
      for (const item of items) {
        const content = await draftOne(apiKey, model, space, item, siblings)
        if (!content) continue
        // Re-read immediately before writing: the user has their vault open
        // and may well have edited this very note while we were drafting it.
        const existing = await db
          .select({ content: notes.content })
          .from(notes)
          .where(and(eq(notes.vaultId, vaultId), eq(notes.path, item.path)))
          .limit(1)
        if (!existing[0] || existing[0].content !== item.placeholder) continue
        await db
          .update(notes)
          .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
          .where(and(eq(notes.vaultId, vaultId), eq(notes.path, item.path)))
        void logUsageEvent({ userId, eventType: 'note_write', metadata: { vault: 'personal', path: item.path, source: 'background-draft' } })
      }
    })().catch((err) => console.error('[draft-notes] background pass failed', err)),
  )
}))
