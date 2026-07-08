// Local LLM tutor via Ollama (http://localhost:11434). No API key, fully on-device.
// Uses the native /api/chat streaming endpoint (newline-delimited JSON).
import type { Note } from '../../vault/types'

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

const SYSTEM = `You are a knowledgeable, concise tutor inside a personal knowledge base (an
Obsidian-style learning vault). The user is studying a topic and asks a question about it.
Answer directly and accurately, like a sharp study companion: explain the concept, use a
concrete example when it helps, and connect it to related ideas in the note when relevant.
Use Markdown. Do not restate the question. Keep it focused — a few tight paragraphs.
Do not use LaTeX or math notation (no $, \\text{}, \\frac{}) — this renders as plain Markdown,
so write formulas and variables in plain text instead, e.g. "MSC = MPC + external cost".`

/** Stream an answer to a question about a note via Ollama. */
export async function answerQuestion(
  note: Note,
  question: string,
  model: string,
  onDelta?: (text: string) => void,
): Promise<string> {
  const context =
    `Note title: ${note.title}\nTags: ${note.tags.join(', ') || '(none)'}\n\n` +
    `--- NOTE CONTENT ---\n${note.body.slice(0, 12000)}\n--- END NOTE ---`
  return chat(
    SYSTEM,
    `Here is the note I'm studying, for context:\n\n${context}\n\nMy question: ${question}`,
    model,
    onDelta,
  )
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
