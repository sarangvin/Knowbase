import type { LlmProvider } from './llmProvider'
import { freeProvider } from './free'
import { proProvider } from './pro'

// Bring-your-own keys and Ollama are gone. Ollama could never work here at
// all — it talks to a server on the user's own machine, which does not exist
// on a phone — and BYO keys meant an encrypted key store, a settings form and
// a proxy route so that one person could supply a key the free tier already
// makes unnecessary.
export const PROVIDERS: LlmProvider[] = [freeProvider, proProvider]

const ACTIVE_STORAGE = 'knowbase:activeProvider'

export function getActiveProviderId(): LlmProvider['id'] {
  const stored = localStorage.getItem(ACTIVE_STORAGE)
  return PROVIDERS.some((p) => p.id === stored) ? (stored as LlmProvider['id']) : 'free'
}

export function setActiveProviderId(id: LlmProvider['id']): void {
  localStorage.setItem(ACTIVE_STORAGE, id)
}

export function getProvider(id: LlmProvider['id']): LlmProvider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}
