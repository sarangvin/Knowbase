// BYO tier: called with the caller's own decrypted API key, never the owner's.
import { readSSE } from '../sse.js'

interface AnthropicEvent {
  type: string
  delta?: { type: string; text?: string }
  error?: { message?: string }
  message?: { usage?: { input_tokens?: number } }
  usage?: { output_tokens?: number }
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
}

export async function* streamAnthropicChat(
  apiKey: string,
  system: string,
  user: string,
  model = 'claude-opus-4-8',
  onUsage?: (usage: Usage) => void,
): AsyncGenerator<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      stream: true,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`)
  }
  const usage: Usage = {}
  for await (const data of readSSE(res.body)) {
    if (data === '[DONE]') break
    let obj: AnthropicEvent
    try {
      obj = JSON.parse(data)
    } catch {
      continue
    }
    if (obj.type === 'error') throw new Error(obj.error?.message ?? 'Anthropic stream error')
    if (obj.type === 'message_start' && obj.message?.usage?.input_tokens != null) {
      usage.inputTokens = obj.message.usage.input_tokens
    }
    if (obj.type === 'message_delta' && obj.usage?.output_tokens != null) {
      usage.outputTokens = obj.usage.output_tokens
    }
    if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && obj.delta.text) {
      yield obj.delta.text
    }
  }
  onUsage?.(usage)
}
