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
import { streamGeminiChat, GeminiHttpError } from './providers/gemini.js'
import { modelChain, isFallbackStatus, reportModelFailure, reportModelSuccess } from './models.js'
import type { Usage } from './providers/anthropic.js'
import { logUsageEvent } from '../usage/logEvent.js'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { NewAccountBudgetError, newAccountBudgetSpent } from '../usage/allowance.js'

/** Refuse a call for a not-yet-approved account once all such accounts have
 *  spent the shared allowance (NEW_ACCOUNTS_DAILY_MODEL_CALLS in plans.ts).
 *
 *  Here, under every model call, rather than in each route: per-route limits
 *  bound what one account does in one place, and this is the one limit that
 *  has to hold across every place at once — including any added later. */
async function assertNewAccountBudget(userId: string | undefined): Promise<void> {
  if (!userId) return
  const [u] = await db
    .select({ approved: users.accessApproved, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u || u.approved || u.role === 'owner') return
  if (await newAccountBudgetSpent()) throw new NewAccountBudgetError()
}

export interface MeteredCallOptions {
  /** Whose quota this is spent on. Omitted for work with no user behind it. */
  userId?: string
  /** Distinguishes onboarding from a grow run from a hand-typed question. */
  source: string
  /** Overrides the per-source default below. */
  timeoutMs?: number
  /** Call only these models, in this order, instead of the chain. For bulk
   *  work that should run on its own quota — the study backfill on Gemma —
   *  and must not spend the Flash-Lite requests interactive use depends on. */
  models?: string[]
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

/** One model used up its slice of the call's deadline. Internal: it is
 *  turned into "try the next model", and never leaves meteredGeminiCall. */
class SliceExpired extends Error {
  constructor(readonly model: string, readonly ms: number) {
    super(`${model} gave no answer in ${Math.round(ms / 1000)}s`)
  }
}

/** How long each kind of call may take before it is abandoned.
 *
 *  The failure being prevented is specific: a draft call was measured at
 *  55.6s, which did not fail — it ran until the platform killed the
 *  invocation holding it, taking the queue row's bookkeeping with it. The
 *  row then sat 'running' for the full five-minute reclaim before anything
 *  retried it. A call that gives up cleanly fails inside a process that is
 *  still alive to write that down.
 *
 *  **The split is who is waiting, not how slow the model is.**
 *
 *  Background work — planning a space, drafting a note, backfilling answers
 *  — happens under `waitUntil` after the response has already gone. Nobody
 *  is watching, so the only cost of waiting longer is the invocation, and
 *  the only cost of giving up early is a wasted call and a collection that
 *  does not grow. These were 20-30s against a 60s ceiling, and the
 *  measurements said that was too tight: `grow-plan` was abandoning 9 calls
 *  in 38 and `onboarding-plan` 15 in 32. Nearly half of a user's first
 *  impression, thrown away at the deadline. They now get 60s each, under a
 *  240s `maxDuration`.
 *
 *  Foreground work — a quiz, a flashcard deck, an answer the reader pressed
 *  a button for — is awaited by the client with a spinner on screen. There
 *  the deadline is a promise about how long someone will be made to wait,
 *  and it stays where it was. Raising it would trade a clean failure for a
 *  longer stare.
 *
 *  One table so the numbers cannot drift apart across five call sites. They
 *  are budgets, not predictions: a plan normally answers in ~3.4s and a
 *  draft in ~4-6s, so these fire only when something is already wrong.
 */
const TIMEOUT_BY_SOURCE: Record<string, number> = {
  // ── background: nobody is watching ──
  'onboarding-plan': 60_000,
  'grow-plan': 60_000,
  'onboarding-draft': 60_000,
  'grow-draft': 60_000,
  'queue-draft': 60_000,
  // Answers several of a note's questions in one call, so it is doing three
  // or four times the work of a single answer and needs the room.
  'answer-backfill': 60_000,
  // Terms and quiz options for one note: a longer answer than a draft's tail.
  'study-backfill': 60_000,

  // ── foreground: the reader is looking at a spinner ──
  'quiz-build': 25_000,
  // One call judging every claim-page pair of a note at once.
  'find-sources': 40_000,
}
const DEFAULT_TIMEOUT_MS = 25_000

export function timeoutFor(source: string): number {
  return TIMEOUT_BY_SOURCE[source] ?? DEFAULT_TIMEOUT_MS
}

/**
 * Collect a full Gemini response and log one llm_call event for it.
 *
 * Walks the model chain (llm/models.ts): if a model answers 404, 429 or 5xx
 * the same prompt goes to the next one, and the failing model is benched so
 * later calls skip it without asking. `preferredModel` is tried first but is
 * not exclusive.
 *
 * One deadline covers every attempt. Falling back is for a model that
 * refused quickly — an error comes back in well under a second — so it costs
 * almost nothing; a model that is merely slow is a timeout, and that is not
 * retried here, for the reason on ModelTimeoutError.
 *
 * Logging is fire-and-forget and swallows its own errors: a metering failure
 * must never fail the generation it was measuring.
 */
export async function meteredGeminiCall(
  apiKey: string,
  system: string,
  user: string,
  opts: MeteredCallOptions,
  preferredModel?: string,
): Promise<string> {
  await assertNewAccountBudget(opts.userId)
  const candidates = opts.models?.length ? opts.models : await modelChain(apiKey, preferredModel)
  const timeoutMs = opts.timeoutMs ?? timeoutFor(opts.source)
  const start = Date.now()
  let usage: Usage = {}
  let model = candidates[0]
  /** Models that refused before this one answered, for the usage log. */
  const skipped: string[] = []
  let timedOut = false

  // The whole stream, not just the first byte. A model that dribbles tokens
  // for a minute costs the same invocation as one that never answers, and
  // the budget being protected is wall clock.
  const abort = new AbortController()

  // Each model gets a slice of the deadline, not all of it. Falling back on
  // an HTTP error covers a model that is broken; this covers one that is
  // merely slow, which is what actually happened — Google's flash-lite
  // models went from 2-4s to a median of 16s with a long tail, nothing
  // errored, and a 25s foreground call waited out its whole budget on the
  // first model and then failed. The slice is 40% of the budget (at least
  // 8s), so a slow primary costs a quarter-minute rather than the call, and
  // the last model left gets whatever remains.
  const sliceMs = Math.max(8_000, Math.round(timeoutMs * 0.4))

  const attempt = async (m: string, budgetMs: number | null): Promise<string> => {
    // Its own controller, so giving up on this model does not abort the
    // call; chained to the call's, so the call's deadline still aborts it.
    const ac = new AbortController()
    const onCallAbort = () => ac.abort()
    abort.signal.addEventListener('abort', onCallAbort)
    let sliceTimer: ReturnType<typeof setTimeout> | undefined
    let sliceExpired = false
    if (budgetMs != null) {
      sliceTimer = setTimeout(() => {
        sliceExpired = true
        ac.abort()
      }, budgetMs)
    }
    const began = Date.now()
    try {
      let acc = ''
      for await (const chunk of streamGeminiChat(apiKey, system, user, m, (u) => { usage = u }, ac.signal)) {
        acc += chunk
      }
      return acc
    } catch (err) {
      if (sliceExpired && !timedOut) throw new SliceExpired(m, Date.now() - began)
      throw err
    } finally {
      clearTimeout(sliceTimer)
      abort.signal.removeEventListener('abort', onCallAbort)
    }
  }

  // Two mechanisms, because they fail differently. The abort signal is the
  // one that matters: it closes the socket, so the work actually stops. The
  // race is what guarantees the *caller* is released on time regardless —
  // an abort only helps if the transport honours it, and a promise that
  // never settles is precisely the failure being designed out. Without the
  // race, one unresponsive stream holds the invocation exactly as before.
  const consume = (async () => {
    for (let i = 0; ; i++) {
      model = candidates[i]
      const last = i === candidates.length - 1
      try {
        const out = await attempt(model, last ? null : sliceMs)
        reportModelSuccess(model)
        return out
      } catch (err) {
        if (timedOut) throw err
        if (err instanceof SliceExpired) {
          // Slow, not broken: bench it, record that it was slow so other
          // instances see it too, and give the next model its slice.
          reportModelFailure(model, 'timeout')
          if (opts.userId) {
            void logUsageEvent({
              userId: opts.userId,
              eventType: 'llm_call',
              provider: 'gemini',
              model,
              latencyMs: err.ms,
              metadata: { source: opts.source, timedOut: true, gaveUpAfterMs: err.ms, fellBackTo: candidates[i + 1] },
            })
          }
          skipped.push(model)
          console.warn(`[model] ${model} gave no answer in ${Math.round(err.ms / 1000)}s; trying ${candidates[i + 1]} (${opts.source})`)
          usage = {}
          continue
        }
        if (err instanceof GeminiHttpError && isFallbackStatus(err.status)) {
          reportModelFailure(model, err)
          if (!last) {
            skipped.push(model)
            console.warn(`[model] ${model} answered ${err.status}; trying ${candidates[i + 1]} (${opts.source})`)
            continue
          }
        }
        throw err
      }
    }
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
    return await Promise.race([consume, deadline])
  } catch (err) {
    if (timedOut) {
      reportModelFailure(model, 'timeout')
      throw new ModelTimeoutError(opts.source, timeoutMs)
    }
    throw err
  } finally {
    clearTimeout(timer)
    // In `finally` on purpose: a call that failed or timed out still consumed
    // rate-limit budget, and those are exactly the ones worth seeing when
    // working out why the limit was hit.
    if (opts.userId) {
      const metadata: Record<string, unknown> = { source: opts.source }
      // Recorded, because a run of these is the signal that the timeouts
      // above are set against a model that has changed under them.
      if (timedOut) metadata.timedOut = true
      // And these are the signal that a model is out: which ones refused
      // before `model` (the one that answered, or failed last) was reached.
      if (skipped.length) metadata.fellBackFrom = skipped
      void logUsageEvent({
        userId: opts.userId,
        eventType: 'llm_call',
        provider: 'gemini',
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Date.now() - start,
        metadata,
      })
    }
  }
}

/**
 * The streaming form of the fallback above, for a route that pipes the reply
 * to the reader as it arrives (Ask AI).
 *
 * A stream cannot be taken back once its first words have gone out, so each
 * model is held until it produces its first chunk: an HTTP refusal surfaces
 * there, before anything is sent, and the next model is tried. Past the
 * first chunk the stream is committed to that model. `onModel` says which
 * one it was, for the usage log.
 */
export async function* streamGeminiWithFallback(
  apiKey: string,
  system: string,
  user: string,
  onUsage: (usage: Usage) => void,
  onModel: (model: string, fellBackFrom: string[]) => void,
): AsyncGenerator<string> {
  const candidates = await modelChain(apiKey)
  const skipped: string[] = []
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]
    const gen = streamGeminiChat(apiKey, system, user, model, onUsage)
    let first: IteratorResult<string>
    try {
      first = await gen.next()
    } catch (err) {
      if (err instanceof GeminiHttpError && isFallbackStatus(err.status)) {
        reportModelFailure(model, err)
        if (i < candidates.length - 1) {
          skipped.push(model)
          console.warn(`[model] ${model} answered ${err.status}; trying ${candidates[i + 1]} (ask-ai)`)
          continue
        }
      }
      onModel(model, skipped)
      throw err
    }
    reportModelSuccess(model)
    onModel(model, skipped)
    if (!first.done) yield first.value
    yield* gen
    return
  }
}
