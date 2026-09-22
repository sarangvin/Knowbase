// One place that calls Gemini and records that it did.
//
// Every model call has to be logged, or the usage figures in the admin panel
// are a confident-looking undercount. Onboarding alone is six calls — a plan
// and five drafts — and none of them were logged before this existed: only
// the two /api/llm proxy routes were, which are the calls a user makes by
// hand and the smallest share of the traffic.
//
// Rate limits are per API key, not per route, so the meter has to sit under
// everything that spends the key.
import { streamGeminiChat, DEFAULT_GEMINI_MODEL } from './providers/gemini.js'
import type { Usage } from './providers/anthropic.js'
import { logUsageEvent } from '../usage/logEvent.js'

export interface MeteredCallOptions {
  /** Whose quota this is spent on. Omitted for work with no user behind it. */
  userId?: string
  /** Distinguishes onboarding from a grow run from a hand-typed question. */
  source: string
  /** Overrides the per-source default below. */
  timeoutMs?: number
}

/** Thrown when a call is cut off for taking too long. Its own type because
 *  callers treat it differently from a model that answered badly: there is
 *  nothing to parse, nothing to log about the response, and retrying inside
 *  the same invocation is pointless — whatever made it slow is still true a
 *  second later. */
export class ModelTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(source: string, timeoutMs: number) {
    const secs = timeoutMs >= 10_000 ? Math.round(timeoutMs / 1000) : Math.round(timeoutMs / 100) / 10
    super(`The model did not answer within ${secs}s (${source}).`)
    this.name = 'ModelTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** How long each kind of call may take before it is abandoned.
 *
 *  Every one of these sits under a 60s function ceiling, and the failure
 *  being prevented is specific: a draft call was measured at 55.6s, which
 *  did not fail — it ran until the platform killed the invocation holding
 *  it, taking the queue row's bookkeeping with it. The row then sat
 *  'running' for the full five-minute reclaim before anything retried it.
 *  A call that gives up at 30s fails cleanly, inside a process that is still
 *  alive to write that down.
 *
 *  One table so the numbers cannot drift apart across five call sites. They
 *  are budgets, not predictions: a plan normally answers in ~3.4s and a
 *  draft in ~4-6s, so these fire only when something is already wrong.
 */
const TIMEOUT_BY_SOURCE: Record<string, number> = {
  'onboarding-plan': 20_000,
  'grow-plan': 20_000,
  // Lower than the queue's: this one shares its invocation with the plan
  // call before it (20 + 25 + writes stays under 60), where a drain does
  // nothing else.
  'onboarding-draft': 25_000,
  'grow-draft': 30_000,
  'queue-draft': 30_000,
  'quiz-build': 25_000,
  // Answers several of a note's questions in one call, so it is doing three
  // or four times the work of a single answer and needs the room. Nobody is
  // waiting on it — it is a background backfill — and at 25s it was timing
  // out often enough to leave notes unfilled and spend the call anyway.
  'answer-backfill': 45_000,
}
const DEFAULT_TIMEOUT_MS = 25_000

export function timeoutFor(source: string): number {
  return TIMEOUT_BY_SOURCE[source] ?? DEFAULT_TIMEOUT_MS
}

/**
 * Collect a full Gemini response and log one llm_call event for it.
 *
 * Logging is fire-and-forget and swallows its own errors: a metering failure
 * must never fail the generation it was measuring.
 */
export async function meteredGeminiCall(
  apiKey: string,
  system: string,
  user: string,
  opts: MeteredCallOptions,
  modelOverride?: string,
): Promise<string> {
  const model = modelOverride ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  const timeoutMs = opts.timeoutMs ?? timeoutFor(opts.source)
  const start = Date.now()
  let usage: Usage = {}
  let out = ''
  let timedOut = false

  // The whole stream, not just the first byte. A model that dribbles tokens
  // for a minute costs the same invocation as one that never answers, and
  // the budget being protected is wall clock.
  const abort = new AbortController()

  // Two mechanisms, because they fail differently. The abort signal is the
  // one that matters: it closes the socket, so the work actually stops. The
  // race is what guarantees the *caller* is released on time regardless —
  // an abort only helps if the transport honours it, and a promise that
  // never settles is precisely the failure being designed out. Without the
  // race, one unresponsive stream holds the invocation exactly as before.
  const consume = (async () => {
    let acc = ''
    for await (const chunk of streamGeminiChat(apiKey, system, user, model, (u) => { usage = u }, abort.signal)) {
      acc += chunk
    }
    return acc
  })()
  // It may lose the race, and a rejection nobody is awaiting takes the
  // process down on unhandledRejection.
  consume.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      abort.abort()
      reject(new ModelTimeoutError(opts.source, timeoutMs))
    }, timeoutMs)
  })

  try {
    out = await Promise.race([consume, deadline])
    return out
  } catch (err) {
    if (timedOut) throw new ModelTimeoutError(opts.source, timeoutMs)
    throw err
  } finally {
    clearTimeout(timer)
    // In `finally` on purpose: a call that failed or timed out still consumed
    // rate-limit budget, and those are exactly the ones worth seeing when
    // working out why the limit was hit.
    if (opts.userId) {
      void logUsageEvent({
        userId: opts.userId,
        eventType: 'llm_call',
        provider: 'gemini',
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Date.now() - start,
        // Recorded, because a run of these is the signal that the timeouts
        // above are set against a model that has changed under them.
        metadata: timedOut ? { source: opts.source, timedOut: true } : { source: opts.source },
      })
    }
  }
}
