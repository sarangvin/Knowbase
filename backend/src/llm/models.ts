// Which Gemini model to call, and which to fall back to.
//
// One model meant one point of failure, and Google's catalogue moves under
// us in three different ways — all of them seen from this key:
//
//   - A model is listed and refuses anyway: gemini-2.5-flash and -flash-lite
//     answer 404, closed to new projects; gemma-4-31b-it answered 500 to
//     every call for weeks.
//   - A model is fine and then is not: on one probe, gemini-3.7-flash,
//     gemini-flash-latest and gemini-3-flash-preview all answered 503
//     UNAVAILABLE at once.
//   - A model runs out: AI Studio's free tier counts requests per model per
//     day, so the primary hitting its quota used to stop all generation
//     until midnight Pacific while every other model had its whole quota
//     unused.
//
// So calls walk an ordered chain and skip what is currently failing. "Based
// on availability" means two checks: the model is in Google's own listing
// for this key (refreshed hourly, so a retired model drops out by itself),
// and it has not failed recently — a failure benches it for as long as that
// kind of failure lasts.
//
// Order is set by quota first and speed second. AI Studio's free tier
// (KnowBase project, read off the rate-limit page):
//   Flash-Lite models   15 requests/min   500 requests/day each
//   Flash models         5 requests/min    20 requests/day each
// So the real backup is the other Flash-Lite. The Flash models are a small
// reserve — 20 a day each covers roughly one onboarding — that is worth
// having for a bad afternoon and useless as a plan. Measured with a
// five-subtopic plan prompt like onboarding's:
//   gemini-3.5-flash-lite   2.5s   500/day  — the primary
//   gemini-3.1-flash-lite   2.0s   500/day
//   gemini-3.5-flash        6.2s    20/day
//   gemini-3.6-flash        9.2s    20/day
//   gemini-3.7-flash         —      20/day  — answered 503 on the probe;
//   gemini-3-flash-preview   —      20/day    kept because a 503 is benched
//                                             in one call and costs nothing
//   gemma-4-26b-a4b-it     27s              — thinks at length first; the
//                                             last resort, by speed
// Left out on purpose: gemma-4-31b-it (80s), gemini-3.8-flash (did not return
// valid JSON), gemini-flash-lite-latest (an alias, so most likely the same
// model and the same quota as the primary), and the 2.5 models (404).
//
// The per-minute limits matter as much as the daily ones: onboarding fires a
// plan and five drafts at once, and two people starting together is a 429
// on the primary. That benches it for a minute, and the overflow goes to
// 3.1-flash-lite rather than failing.
//
// GEMINI_MODEL, if set, is tried first. GEMINI_MODELS (comma-separated)
// replaces the chain. Both need a redeploy, like any env change.
//
// Benching is per server instance, in memory. That is deliberate: each
// instance learns within one failed call, and a shared store would add a
// query to every model call to save the occasional instance one fast 503.
import { QUOTA_TZ } from '../usage/quotaWindow.js'

export const DEFAULT_MODEL_CHAIN = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
  'gemma-4-26b-a4b-it',
]

/** Failures that say "this model, right now" rather than "this request". A
 *  400 is the request — the next model would refuse it too — so it is not
 *  here, and neither is a timeout: the call's time is already spent. */
const FALLBACK_STATUSES = new Set([404, 429, 500, 502, 503, 504])

export function isFallbackStatus(status: number): boolean {
  return FALLBACK_STATUSES.has(status)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Model -> benched until (epoch ms). */
const benched = new Map<string, number>()

let listing: { at: number; names: Set<string> } | null = null
const LISTING_TTL = HOUR

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}

/** The configured order: GEMINI_MODEL first if set, then GEMINI_MODELS or
 *  the default chain. Empty strings are ignored — `GEMINI_MODEL=` with no
 *  value is a real thing to find in an .env file, and read as a model name
 *  it sends a request for a model called "". */
export function configuredChain(): string[] {
  const fromEnv = (process.env.GEMINI_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const primary = (process.env.GEMINI_MODEL ?? '').trim()
  return dedupe([primary, ...(fromEnv.length ? fromEnv : DEFAULT_MODEL_CHAIN)].filter(Boolean))
}

/** The model a call starts with when nothing is benched. */
export function primaryModel(): string {
  return configuredChain()[0]
}

/** Models Google lists for this key as supporting generateContent, or null
 *  if that cannot be found out right now — in which case nothing is filtered
 *  on it, since a failed listing says nothing about the models. */
async function listedModels(apiKey: string): Promise<Set<string> | null> {
  if (listing && Date.now() - listing.at < LISTING_TTL) return listing.names
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) return listing?.names ?? null
    const data = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[]
    }
    const names = new Set(
      (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean),
    )
    listing = { at: Date.now(), names }
    return names
  } catch {
    return listing?.names ?? null
  }
}

/**
 * The models to try, in order, for one call.
 *
 * `preferred` goes first when given — a caller that names a model is saying
 * "this one if you can", not "only this one"; a fixed model was exactly what
 * made a single outage total.
 *
 * Never empty. If every model is benched, all listed ones are returned
 * anyway: a bench that has outlived its outage is cheaper to find out about
 * than a call that fails without trying.
 */
export async function modelChain(apiKey: string, preferred?: string): Promise<string[]> {
  const chain = dedupe([preferred?.trim() ?? '', ...configuredChain()].filter(Boolean))
  const names = await listedModels(apiKey)
  const listed = names ? chain.filter((m) => names.has(m)) : chain
  // Nothing in the chain is listed at all: the listing is wrong or the chain
  // is, and either way trying is the only way to find out.
  const candidates = listed.length ? listed : chain
  const now = Date.now()
  const ready = candidates.filter((m) => (benched.get(m) ?? 0) <= now)
  return ready.length ? ready : candidates
}

/** Milliseconds until the next midnight in the provider's quota zone, where
 *  AI Studio's per-day counts reset. */
function msToQuotaReset(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const elapsed = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second')
  return Math.max(MINUTE, (24 * 3600 - elapsed) * 1000)
}

/** Bench a model for as long as this kind of failure tends to last. */
export function reportModelFailure(model: string, failure: { status: number; body?: string } | 'timeout'): void {
  let ms: number
  if (failure === 'timeout') {
    ms = 2 * MINUTE
  } else if (failure.status === 404) {
    // Not available to this key at all. The hourly listing usually catches
    // this first; a model that is listed and still 404s stays out longer.
    ms = 6 * HOUR
  } else if (failure.status === 429) {
    // A per-day quota is out until the reset; anything else is a per-minute
    // rate and comes back in a minute. Google names which in the body.
    ms = /per\s*day|perday/i.test(failure.body ?? '') ? msToQuotaReset() : MINUTE
  } else if (failure.status >= 500) {
    ms = 2 * MINUTE
  } else {
    return
  }
  benched.set(model, Date.now() + ms)
}

/** A model that answered is a model that works; any bench it was on is over. */
export function reportModelSuccess(model: string): void {
  benched.delete(model)
}

/** The model a call would start with right now: the first in the chain not
 *  benched on this instance. For display — calls go through modelChain. */
export function currentModel(): string {
  const now = Date.now()
  const chain = configuredChain()
  return chain.find((m) => (benched.get(m) ?? 0) <= now) ?? chain[0]
}

/** For the admin panel: the configured chain with each model's state. */
export function chainStatus(): { model: string; benchedUntil: string | null }[] {
  const now = Date.now()
  return configuredChain().map((model) => {
    const until = benched.get(model) ?? 0
    return { model, benchedUntil: until > now ? new Date(until).toISOString() : null }
  })
}
