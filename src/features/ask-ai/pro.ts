// Paid tier: a better hosted model, gated server-side on users.plan_tier
// (kept in sync by the Razorpay webhook). checkReady() is only a client-side
// hint for the UI — the backend re-checks the plan on every call regardless.
import type { LlmProvider } from './llmProvider'
import { streamFromBackend } from './backendProxy'
import { getSubscriptionStatus } from '../settings/billing'

export const proProvider: LlmProvider = {
  id: 'pro',
  label: 'Pro (better model)',

  async checkReady() {
    try {
      const { planTier } = await getSubscriptionStatus()
      return planTier === 'pro'
        ? { ready: true }
        : { ready: false, message: 'Upgrade to Pro in Settings to use the better model.' }
    } catch {
      return { ready: false, message: 'Could not reach the server to check your plan.' }
    }
  },

  async streamChat(system, user, opts) {
    return streamFromBackend('/api/llm/pro/chat', { system, user }, opts.onDelta)
  },
}
