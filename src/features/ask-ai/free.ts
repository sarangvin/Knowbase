// Free default tier: a hosted Gemma model, called through the backend using
// the owner's own Groq key — no setup required, but rate-limited per user
// (see backend/src/middleware/rateLimit.ts). Errors (including the 429 rate
// limit message) surface via the thrown Error from streamFromBackend.
import type { LlmProvider } from './llmProvider'
import { streamFromBackend } from './backendProxy'

export const freeProvider: LlmProvider = {
  id: 'free',
  label: 'Free (Gemma)',

  async streamChat(system, user, opts) {
    return streamFromBackend('/api/llm/free/chat', { system, user }, opts.onDelta)
  },
}
