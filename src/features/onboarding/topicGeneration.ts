// LLM orchestration for topic onboarding: prompt building, calling the free
// tier (hardcoded — this is the zero-setup moment, no checkReady()/plan-tier
// gating needed), defensive JSON extraction/validation, one retry.
import { freeProvider } from '../ask-ai/free'
import { breakCycles, ensureFoundational, type Subtopic } from './notePlan'

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

export async function generateLearningPlan(topic: string): Promise<ValidatedPlan> {
  // A thrown error (network/API failure — the free tier's model is a preview
  // model observed to fail transiently a meaningful fraction of the time, not
  // just theoretically) must fall through to the retry exactly like a
  // validation failure does, not abort immediately.
  try {
    const first = await freeProvider.streamChat(TOPIC_SYSTEM_PROMPT, buildUserPrompt(topic), {})
    const validated = parseAndValidate(first)
    if (validated) return validated
  } catch {
    /* fall through to retry */
  }

  try {
    const second = await freeProvider.streamChat(TOPIC_SYSTEM_PROMPT, buildRetryUserPrompt(topic), {})
    const revalidated = parseAndValidate(second)
    if (revalidated) return revalidated
  } catch {
    /* fall through to the error below */
  }

  throw new Error("Couldn't generate a valid learning plan — try again, or try a different topic phrasing.")
}
