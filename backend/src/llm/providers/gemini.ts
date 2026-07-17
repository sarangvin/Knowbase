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
export const DEFAULT_GEMINI_MODEL = 'gemma-4-31b-it'

export async function* streamGeminiChat(
  apiKey: string,
  system: string,
  user: string,
  model: string,
  onUsage?: (usage: Usage) => void,
): AsyncGenerator<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`)
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
    const part = obj.candidates?.[0]?.content?.parts?.[0]
    if (part?.text && !part.thought) yield part.text
  }
  onUsage?.(usage)
}
