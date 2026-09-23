// Server-side generation of the starter learning plan for a topic.
//
// Moved out of the browser (src/features/onboarding/topicGeneration.ts) when
// onboarding stopped being a thing the client drives. The prompt and the
// validation below are that file's, unchanged — they were the part worth
// keeping; only the transport differs, calling Gemini directly the way
// routes/draftNotes.ts already does instead of going back out through the
// app's own /api/llm/free proxy, which would be this process calling itself.
import { meteredGeminiCall } from '../llm/meter.js'
import { breakCycles, ensureFoundational, type Subtopic } from './notePlan.js'

function callModel(system: string, user: string, userId: string | undefined, source: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  // Thrown, not returned empty: this is the one failure the user can be told
  // something true about, and generateLearningPlan below deliberately
  // preserves the last real error instead of flattening it to "try another
  // phrasing".
  if (!apiKey) throw new Error('The free tier is not configured on this server (no model key set).')
  return meteredGeminiCall(apiKey, system, user, { userId, source })
}

const TOPIC_SYSTEM_PROMPT = `You are a curriculum designer helping a complete beginner start learning a brand-new topic
from scratch. You will be given a topic the learner wants to study. Produce a small starter
learning plan: a short space name for the topic, and exactly 5 subtopics that break the topic
into a learnable sequence for someone with zero prior knowledge of it.

Rules:
- Respond with ONLY a single JSON object. No markdown code fences, no prose before or after,
  no comments.
- The JSON object must exactly match this shape:
{
  "space": string,                // short 1-4 word name for this topic, Title Case, e.g. "Linear Algebra"
  "subtopics": [                  // exactly 5 entries
    {
      "title": string,            // short, specific subtopic name, Title Case
      "summary": string,          // 1-2 sentence plain-English description of what it covers
      "prerequisites": string[],  // titles of OTHER subtopics in this list needed first; [] if none
      "importance": number,       // 1-5, how core this subtopic is to the overall topic
      "interest": number          // 1-5, how independently engaging this subtopic tends to be
    }
    // ... exactly 5 of these
  ]
}
- Assume the learner knows NOTHING about this topic yet — order and connect the 5 subtopics
  as a beginner's on-ramp, not an expert curriculum.
- At least 1-2 of the 5 subtopics must have "prerequisites": [] — true starting points a
  beginner can tackle immediately with no background.
- Every string in "prerequisites" must exactly match the "title" of another subtopic in this
  same list. Never invent a reference to a topic outside this list of 5, and never list a
  subtopic as its own prerequisite.
- Keep titles short (a few words) and free of colons, slashes, brackets, or quotation marks.`


function buildUserPrompt(topic: string): string {
  return `I want to learn about: "${topic}". Generate my starter learning plan as specified.`
}

function buildRetryUserPrompt(topic: string): string {
  return `Your previous response could not be parsed as the required JSON object. Respond with ONLY
valid JSON matching the schema exactly — no prose, no code fences, no trailing commas.

I want to learn about: "${topic}". Generate my starter learning plan as specified.`
}

interface RawSubtopic {
  title?: unknown
  summary?: unknown
  prerequisites?: unknown
  importance?: unknown
  interest?: unknown
}
interface RawPlan {
  space?: unknown
  subtopics?: unknown
}

function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1].trim() : trimmed
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export interface ValidatedPlan {
  space: string
  subtopics: Subtopic[]
}

/** Exported for testing. Strip fences, parse, validate shape/count/uniqueness,
 * drop out-of-batch prerequisite references, then run the deterministic
 * cycle-break + ensure-foundational repair. Returns null on any hard failure
 * (caller retries once with a stricter prompt). */
export function parseAndValidate(raw: string): ValidatedPlan | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as RawPlan

  const space = typeof obj.space === 'string' ? obj.space.trim().slice(0, 60) : ''
  if (!space) return null

  if (!Array.isArray(obj.subtopics) || obj.subtopics.length < 5) return null
  const rawFive = (obj.subtopics as RawSubtopic[]).slice(0, 5)

  const withTitles = rawFive
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title.trim().slice(0, 80) : '',
      summary: typeof r.summary === 'string' ? r.summary : '',
      prerequisites: Array.isArray(r.prerequisites)
        ? r.prerequisites.filter((p): p is string => typeof p === 'string')
        : [],
      importance: clampInt(r.importance, 3, 1, 5),
      interest: clampInt(r.interest, 3, 1, 5),
    }))
    .filter((s) => s.title.length > 0)

  if (withTitles.length < 5) return null

  // Reject on duplicate titles rather than paper over — cheap for the model
  // to avoid, and prerequisite-by-title resolution depends on uniqueness.
  const lowerTitles = withTitles.map((s) => s.title.toLowerCase())
  if (new Set(lowerTitles).size !== lowerTitles.length) return null

  const titleSet = new Set(withTitles.map((s) => s.title))
  const cleaned: Subtopic[] = withTitles.map((s) => ({
    ...s,
    // Drop anything that doesn't resolve in-batch (dangling refs would be
    // permanently unresolvable by resolveTarget) rather than hard-failing.
    prerequisites: [...new Set(s.prerequisites)].filter((p) => titleSet.has(p) && p !== s.title),
  }))

  const repaired = ensureFoundational(breakCycles(cleaned))
  if (repaired.length !== 5 || !repaired.some((s) => s.prerequisites.length === 0)) return null

  return { space, subtopics: repaired }
}

export async function generateLearningPlan(topic: string, userId?: string): Promise<ValidatedPlan> {
  // A thrown error (network/API failure — the free tier's model is a preview
  // model observed to fail transiently a meaningful fraction of the time, not
  // just theoretically) must fall through to the retry exactly like a
  // validation failure does, not abort immediately.
  //
  // But it must not be *discarded*. Both attempts used to be wrapped in bare
  // `catch {}`, so a server-side failure — no API key configured, a 429, a
  // 502 from the upstream model — surfaced as "try a different topic
  // phrasing", pointing the user at their own input when nothing they typed
  // could possibly help. Keep the last real error and let it through.
  let lastError: unknown = null

  for (const buildPrompt of [buildUserPrompt, buildRetryUserPrompt]) {
    try {
      const raw = await callModel(TOPIC_SYSTEM_PROMPT, buildPrompt(topic), userId, 'onboarding-plan')
      const validated = parseAndValidate(raw)
      if (validated) return validated
      // Reached the model fine, but the response didn't satisfy the schema.
      // Log the raw text: this is the only place it exists, and without it a
      // validation failure is indistinguishable from a transport failure.
      console.warn('[learning-plan] response failed validation:', raw.slice(0, 2000))
      lastError = new Error(
        "The model's reply didn't match the expected format — try again, or try a different topic phrasing.",
      )
    } catch (err) {
      console.warn('[learning-plan] request failed:', err)
      lastError = err
      // A timeout no longer stops the loop.
      //
      // It used to, on the reasoning that a second attempt spends another
      // 20s of the same 60s invocation to learn what the first one just
      // established. Two things have since made that wrong. The measured
      // one: latency on this model is wildly variable, so a retry after a
      // timeout usually succeeds — the same finding that removed this break
      // from generateNextTopics. The structural one: the invocation is 240s
      // now and the deadline is 60s, so a second attempt costs budget that
      // is there rather than budget that is not.
      //
      // And the cost of stopping fell on the worst possible person. This is
      // the call that builds somebody's first collection; giving up after
      // one slow response is how three accounts were told "the model did
      // not answer within 20s" and left with nothing.
    }
  }

  // A real error from the backend (it carries the server's own message, e.g.
  // the missing-key or rate-limit text) is far more useful than a generic
  // line, so prefer it.
  if (lastError instanceof Error) throw lastError
  throw new Error("Couldn't generate a valid learning plan — try again, or try a different topic phrasing.")
}

// ── Growing an existing space ───────────────────────────────────────────────

const NEXT_SYSTEM_PROMPT = `You are a curriculum designer extending someone's existing learning plan. You will be given
a subject, the topics already in their plan, and which of those they have already studied.
Propose the next subtopics for them to learn.

Rules:
- Respond with ONLY a single JSON object. No markdown code fences, no prose before or after.
- The JSON object must exactly match this shape:
{
  "subtopics": [
    {
      "title": string,            // short, specific subtopic name, Title Case
      "summary": string,          // 1-2 sentence plain-English description of what it covers
      "prerequisites": string[],  // titles they must know first — may reference EXISTING topics
                                  // listed in the prompt, or other new subtopics in this list
      "importance": number,       // 1-5, how core this subtopic is to the overall subject
      "interest": number          // 1-5, how independently engaging this subtopic tends to be
    }
  ]
}
- Propose exactly the number of subtopics asked for.
- They build on what the learner already knows: prefer prerequisites drawn from the topics
  marked as studied, so the new work is reachable rather than blocked.
- Do NOT repeat or rephrase any topic already in their plan. These must be genuinely new
  ground in the same subject.
- Every prerequisite string must exactly match either an existing topic title given to you or
  the title of another subtopic in this list. Never invent anything else, and never list a
  subtopic as its own prerequisite.
- Keep titles short (a few words) and free of colons, slashes, brackets, or quotation marks.`

function buildNextUserPrompt(space: string, studied: string[], all: string[], count: number): string {
  const unstudied = all.filter((t) => !studied.includes(t))
  return `Subject: "${space}"

Topics already in their plan:
${all.map((t) => `- ${t}${studied.includes(t) ? ' (STUDIED)' : ''}`).join('\n')}

${studied.length ? `They have studied: ${studied.join(', ')}.` : 'They have not finished any topic yet.'}
${unstudied.length ? `Still unstudied: ${unstudied.join(', ')}.` : ''}

Propose exactly ${count} new subtopic${count === 1 ? '' : 's'} that take${count === 1 ? 's' : ''} them further into "${space}", building on what they have studied.`
}

/** Validates a "next topics" response against the titles that already exist.
 *  Separate from parseAndValidate because the shapes genuinely differ: no
 *  space name, a variable count, and prerequisites that may point at topics
 *  outside this batch — which is the whole point of growing a tree rather
 *  than generating a fresh one. */
export function parseNextTopics(raw: string, existingTitles: string[], want: number): Subtopic[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const list = (parsed as { subtopics?: unknown }).subtopics
  if (!Array.isArray(list) || list.length === 0) return null

  const existingLower = new Set(existingTitles.map((t) => t.toLowerCase()))
  const seen = new Set<string>()
  const out: Subtopic[] = []

  for (const r of list as RawSubtopic[]) {
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 80) : ''
    if (!title) continue
    const lower = title.toLowerCase()
    // Silently dropping a duplicate is right: the model re-proposing something
    // they already have is a near miss, not a reason to throw the batch away.
    if (existingLower.has(lower) || seen.has(lower)) continue
    seen.add(lower)
    out.push({
      title,
      summary: typeof r.summary === 'string' ? r.summary : '',
      prerequisites: Array.isArray(r.prerequisites)
        ? r.prerequisites.filter((p): p is string => typeof p === 'string')
        : [],
      importance: clampInt(r.importance, 3, 1, 5),
      interest: clampInt(r.interest, 3, 1, 5),
    })
    if (out.length === want) break
  }
  if (out.length === 0) return null

  // A prerequisite may point at an existing topic or at a sibling in this
  // batch; anything else would be a permanently unresolvable wikilink.
  const resolvable = new Set([...existingTitles, ...out.map((s) => s.title)])
  return out.map((s) => ({
    ...s,
    prerequisites: [...new Set(s.prerequisites)].filter((p) => resolvable.has(p) && p !== s.title),
  }))
}

/** Next subtopics for a space the learner is already working through.
 *  Returns null rather than throwing: growing a tree is a background nicety,
 *  and a failure must never surface to someone who simply marked a note read. */
export async function generateNextTopics(
  space: string,
  studied: string[],
  all: string[],
  count: number,
  userId?: string,
): Promise<Subtopic[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callModel(NEXT_SYSTEM_PROMPT, buildNextUserPrompt(space, studied, all, count), userId, 'grow-plan')
      const parsed = parseNextTopics(raw, all, count)
      if (parsed) return parsed
      console.warn('[grow] response failed validation:', raw.slice(0, 400))
    } catch (err) {
      console.warn('[grow] request failed:', err)
      // Deliberately NOT breaking on a timeout, unlike the learning plan
      // above. That break assumed "whatever made the model slow is still
      // true a second later"; measured, it is not — consecutive calls with
      // the same prompt came back in 1.6s, 2.6s, 10s, 13s, 16s and 20s+,
      // so roughly one in four timed out and a retry usually succeeds.
      //
      // Growth can afford it where onboarding cannot: nobody is waiting,
      // and /grow hands drainQueue an absolute deadline, so if two attempts
      // eat the invocation the draft is simply left for the next poll.
    }
  }
  return null
}
