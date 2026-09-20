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
  const start = Date.now()
  let usage: Usage = {}
  let out = ''
  try {
    for await (const chunk of streamGeminiChat(apiKey, system, user, model, (u) => { usage = u })) {
      out += chunk
    }
    return out
  } finally {
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
        metadata: { source: opts.source },
      })
    }
  }
}
