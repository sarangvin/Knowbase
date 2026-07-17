// BYO Claude tier. The key is saved once via Settings (POST /api/settings/keys,
// encrypted at rest, plaintext discarded server-side) and every call proxies
// through the backend (POST /api/llm/anthropic/chat) — no API key of any kind
// touches this module or any browser JS after the initial save, unlike the
// old dangerouslyAllowBrowser + direct-SDK approach this replaces.
import type { LlmProvider } from './llmProvider'
import { streamFromBackend } from './backendProxy'
import { listSavedKeys } from './keys'

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',
  label: 'Claude (your key)',

  async checkReady() {
    try {
      const keys = await listSavedKeys()
      const saved = keys.find((k) => k.provider === 'anthropic')
      return saved
        ? { ready: true }
        : { ready: false, message: 'Add your Anthropic API key in Settings to use Claude.' }
    } catch {
      return { ready: false, message: 'Could not reach the server to check your saved key.' }
    }
  },

  async streamChat(system, user, opts) {
    return streamFromBackend('/api/llm/anthropic/chat', { system, user }, opts.onDelta)
  },
}
