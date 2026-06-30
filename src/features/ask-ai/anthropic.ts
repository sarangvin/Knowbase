// Browser-side Claude integration for the in-app tutor. The user supplies their
// own API key (stored only in this browser's localStorage); we never ship a key.
// Direct browser calls require dangerouslyAllowBrowser — acceptable for a
// local-first personal tool, but it does expose the key to client-side code.
import Anthropic from '@anthropic-ai/sdk'
import type { Note } from '../../vault/types'

const KEY_STORAGE = 'knowbase:anthropicKey'

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? ''
}
export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEY_STORAGE, key)
  else localStorage.removeItem(KEY_STORAGE)
}
export function hasApiKey(): boolean {
  return !!getApiKey()
}

const MODEL = 'claude-opus-4-8'

const SYSTEM = `You are a knowledgeable, concise tutor inside a personal knowledge base
(an Obsidian-style "Automated Graph" learning vault). The user is studying a topic and asks
a question about it. Answer directly and accurately, at the level of a sharp study companion:
explain the concept, use a concrete example when it helps, and connect it to related ideas in
the note when relevant. Use Markdown. Do not restate the question. Keep it focused — a few
tight paragraphs, not an essay.`

/** Stream an answer to a question about a note. Calls onDelta with text chunks. */
export async function answerQuestion(
  note: Note,
  question: string,
  onDelta: (text: string) => void,
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('No API key set')

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const context = `Note title: ${note.title}\nTags: ${note.tags.join(', ') || '(none)'}\n\n` +
    `--- NOTE CONTENT ---\n${note.body.slice(0, 12000)}\n--- END NOTE ---`

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Here is the note I'm studying, for context:\n\n${context}\n\nMy question: ${question}`,
      },
    ],
  })

  let full = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      full += event.delta.text
      onDelta(event.delta.text)
    }
  }
  await stream.finalMessage()
  return full
}
