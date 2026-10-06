// Free tier: always called with the owner's own GEMINI_API_KEY env var, never
// a user-supplied key. Uses Google's Generative Language API directly (not
// Groq — Groq dropped every Gemma model from their catalog; verified live
// against their /v1/models endpoint, not just docs). This API serves actual
// Gemma models, matching the product requirement, via the same key you'd get
// from https://aistudio.google.com/apikey.
import { readSSE } from '../sse.js'
import type { Usage } from './anthropic.js'

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

// Configurable via GEMINI_MODEL env var (see routes/llm.ts) — hardcoding a
// specific hosted model name is exactly what just broke the Groq/Gemma setup
// when the provider deprecated it out from under us. Verified live against
// this API's /v1beta/models listing: Google now serves Gemma 4
// (gemma-4-31b-it, gemma-4-26b-a4b-it), not Gemma 3 — model generations
// change faster than this comment will, which is the whole point of keeping
// this overridable via env var instead of trusting any hardcoded name.
// Model history, because both previous choices failed in non-obvious ways:
//   gemma-4-31b-it    — still listed by the API, but every generateContent
//                       call returns 500 INTERNAL. Reproduced with plain curl.
//   gemma-4-26b-a4b-it — works, but it is a "thinking" variant: on the
//                       onboarding plan prompt it spends ~53s emitting ~8,000
//                       characters of reasoning traces that this code then
//                       discards, against a 60s Vercel function limit. Any
//                       variance tipped it over and the user watched a
//                       spinner until the request died.
// gemini-3.5-flash-lite answers the same prompt in ~1.7s with no thinking
// traces and identical schema-valid JSON — measured, not assumed.
//
// Which model a call uses is no longer decided here: llm/models.ts holds the
// ordered chain and what is currently failing, and callers ask it.

/** A non-2xx from the API. Typed, so a caller can tell "this model is out
 *  right now" (404, 429, 5xx — try another) from "this request is wrong"
 *  (400 — another model would refuse it too) without reading the message. */
export class GeminiHttpError extends Error {
  readonly status: number
  readonly body: string
  readonly model: string
  constructor(model: string, status: number, body: string) {
    super(`Gemini API error ${status} (${model}): ${body.slice(0, 300)}`)
    this.name = 'GeminiHttpError'
    this.status = status
    this.body = body
    this.model = model
  }
}

export async function* streamGeminiChat(
  apiKey: string,
  system: string,
  user: string,
  model: string,
  onUsage?: (usage: Usage) => void,
  /** Aborts the request *and the stream it is reading*. Passing it to fetch
   *  is what makes a timeout real: without it the socket stays open, the
   *  body keeps arriving, and a caller that "gave up" is still holding the
   *  invocation it was trying to release. */
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // Gemma 4 thinks at length before answering unless told not to: a
      // study-material prompt took 75-115s with it on. "minimal" is the
      // lowest level these models accept (a thinking budget of 0 is
      // refused with a 400), and on a small prompt cut 12s to 4s. Gemini
      // models are left at their defaults.
      ...(model.startsWith('gemma-') ? { generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } } : {}),
    }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new GeminiHttpError(model, res.status, text)
  }
  const usage: Usage = {}
  for await (const data of readSSE(res.body)) {
    let obj: GeminiChunk
    try {
      obj = JSON.parse(data)
    } catch {
      continue
    }
    if (obj.usageMetadata) {
      usage.inputTokens = obj.usageMetadata.promptTokenCount
      usage.outputTokens = obj.usageMetadata.candidatesTokenCount
    }
    // Gemma 4's "thinking" variants emit reasoning-trace parts marked
    // thought: true before the real answer (verified live — its content is
    // scratch reasoning like "* User input: ...", not meant to be shown as
    // the response) — only yield genuine answer parts.
    // Every part, not the first: a chunk can carry the end of the thinking
    // and the start of the answer together, and reading only parts[0] threw
    // the answer away — the reply came back empty and failed to parse.
    for (const part of obj.candidates?.[0]?.content?.parts ?? []) {
      if (part.text && !part.thought) yield part.text
    }
  }
  onUsage?.(usage)
}
