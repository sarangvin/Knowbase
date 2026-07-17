import type { LlmProvider } from './llmProvider'
import { freeProvider } from './free'
import { anthropicProvider } from './anthropic'
import { ollamaProvider } from './ollama'
import { proProvider } from './pro'

export const PROVIDERS: LlmProvider[] = [freeProvider, proProvider, anthropicProvider, ollamaProvider]

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
