// Drafting one note's body with the model, and splicing it into the
// placeholder the note was created with.
//
// Extracted from routes/draftNotes.ts so the onboarding pipeline
// (onboarding/run.ts) and that route share one implementation. There is
// exactly one correct way to fill a generated note and two copies of it would
// drift — the same reason fillPlaceholder below patches the placeholder in
// place rather than rebuilding the note from scratch.
import { meteredGeminiCall } from '../llm/meter.js'

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
  "questions": [          // 3 of them. Real comprehension questions, not "what is X?".
    {
      "q": string,        // a question the learner should be able to answer once they know this
      "a": string         // the answer, 2-4 sentences, answered from what you wrote above
    }
  ]
}
- Every question comes with its answer. The reader sees the question first and
  reveals the answer when they want it, so the answer must stand on its own and
  must not be a restatement of the question.
- Write for a beginner: define jargon the first time you use it.
- Be concrete. Prefer a specific example or number over a general claim.
- Do NOT invent URLs, citations, book titles or paper references of any kind.
- Do not mention that you are an AI or describe what you are doing.`

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
interface DraftQuestion {
  q: string
  a: string
}

function fillPlaceholder(
  placeholder: string,
  overview: string,
  keyPoints: string[],
  questions: DraftQuestion[],
): string {
  const ai =
    sanitizeBlock(overview) +
    (keyPoints.length ? '\n\n**Key points**\n\n' + keyPoints.map((k) => `- ${sanitizeInline(k)}`).join('\n') : '')

  let out = placeholder.replace(
    /(^## AI Notes\n\n)([\s\S]*?)(?=\n## )/m,
    (_m, head: string) => `${head}${ai}\n`,
  )
  // The body is no longer a stub, so the flag that said so goes with it —
  // this is what makes the "(Coming soon)" marker disappear on its own.
  out = out.replace(/^pending:\s*true[ \t]*\r?\n/m, '')
  if (questions.length) {
    // `Q:` / `A:` blocks, not bullets. The bullet shape is why this section
    // did nothing for months: everything that acts on a question looks for
    // `Q:`. Writing the answer here as well is what makes the reader's
    // Answer button a reveal rather than a model call — see
    // docs/flows/questions.md.
    out = out.replace(/(^## Questions\n\n)([\s\S]*)$/m, (_m, head: string) => {
      const blocks = questions.map((q) =>
        q.a ? `Q: ${sanitizeInline(q.q)}\n\nA: ${sanitizeInline(q.a)}` : `Q: ${sanitizeInline(q.q)}`,
      )
      return `${head}${blocks.join('\n\n')}\n`
    })
  }
  return out
}

export async function draftOne(
  apiKey: string,
  model: string,
  space: string,
  item: DraftRequestItem,
  siblings: string[],
  /** Whose quota the call is spent on, for the usage figures in admin. */
  userId?: string,
  source = 'draft-note',
): Promise<string | null> {
  const others = siblings.filter((t) => t !== item.title)
  const user = `Overall subject: "${space}"
Subtopic to write about: "${item.title}"
What it should cover: ${item.summary}
${others.length ? `Other subtopics in the same plan (for context; don't duplicate them): ${others.join(', ')}` : ''}

Write the first-draft study note for "${item.title}" as specified.`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await meteredGeminiCall(apiKey, NOTE_SYSTEM_PROMPT, user, { userId, source }, model)
      const parsed = JSON.parse(stripFence(raw)) as {
        overview?: unknown
        key_points?: unknown
        questions?: unknown
      }
      const overview = typeof parsed.overview === 'string' ? parsed.overview.trim() : ''
      if (!overview) continue
      const strings = (v: unknown) =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []
      // Tolerates the old shape — a bare string — so a model that ignores
      // the schema still yields a question, just without its answer. The
      // reader's Answer button falls back to generating one.
      const questions: DraftQuestion[] = Array.isArray(parsed.questions)
        ? parsed.questions
            .map((x): DraftQuestion => {
              if (typeof x === 'string') return { q: x.trim(), a: '' }
              const o = (x ?? {}) as { q?: unknown; a?: unknown }
              return {
                q: typeof o.q === 'string' ? o.q.trim() : '',
                a: typeof o.a === 'string' ? o.a.trim() : '',
              }
            })
            .filter((x) => x.q)
        : []
      return fillPlaceholder(item.placeholder, overview, strings(parsed.key_points), questions)
    } catch (err) {
      console.warn(`[draft-notes] "${item.title}" attempt ${attempt + 1} failed:`, err)
    }
  }
  return null
}
