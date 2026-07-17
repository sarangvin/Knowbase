// Local LLM tutor via Ollama (http://localhost:11434). No API key, fully on-device.
// Uses the native /api/chat streaming endpoint (newline-delimited JSON).
// Always client-direct — unlike the BYO/free tiers, this can't be proxied
// through the backend since it talks to a server on the user's own machine.
import type { LlmProvider } from './llmProvider'

const BASE_STORAGE = 'knowbase:ollamaBaseUrl'
const MODEL_STORAGE = 'knowbase:ollamaModel'
const DEFAULT_BASE = 'http://localhost:11434'

export function getBaseUrl(): string {
  return localStorage.getItem(BASE_STORAGE) || DEFAULT_BASE
}
export function setBaseUrl(url: string): void {
  if (url) localStorage.setItem(BASE_STORAGE, url.replace(/\/+$/, ''))
  else localStorage.removeItem(BASE_STORAGE)
}
export function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE) || ''
}
export function setModel(model: string): void {
  localStorage.setItem(MODEL_STORAGE, model)
}

/** List installed models; throws if Ollama isn't reachable. */
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${getBaseUrl()}/api/tags`)
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`)
  const data = (await res.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((m) => m.name)
}

/** Generic streaming chat call against the local Ollama server. */
export async function chat(
  system: string,
  user: string,
  model: string,
  onDelta?: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${getBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok || !res.body) throw new Error(`Ollama responded ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let obj: { message?: { content?: string }; error?: string }
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (obj.error) throw new Error(obj.error)
      const chunk = obj.message?.content
      if (chunk) {
        full += chunk
        onDelta?.(chunk)
      }
    }
  }
  return full
}

export const ollamaProvider: LlmProvider = {
  id: 'ollama',
  label: 'Ollama (local)',
  listModels,
  async checkReady() {
    try {
      await listModels()
      return { ready: true }
    } catch {
      const hosted = !/^(localhost|127\.)/.test(location.hostname)
      const hint = hosted
        ? ` Since this site is hosted, also allow it as an origin: OLLAMA_ORIGINS="${location.origin}" ollama serve`
        : ''
      return {
        ready: false,
        message: `Can't reach a local Ollama server at ${getBaseUrl()}. Start it with "ollama serve" and pull a model.${hint}`,
      }
    }
  },
  async streamChat(system, user, opts) {
    return chat(system, user, opts.model ?? getModel(), opts.onDelta)
  },
}
