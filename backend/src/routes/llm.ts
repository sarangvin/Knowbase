import { Router, type Request } from 'express'
import { requireAuth, requireApproved } from '../auth/session.js'
import { requirePlan } from '../middleware/requirePlan.js'
import { freeTierRateLimit } from '../middleware/rateLimit.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { streamAnthropicChat, type Usage } from '../llm/providers/anthropic.js'
import { streamGeminiChat, DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { pipeTextStream } from '../llm/proxy.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const llmRouter = Router()
llmRouter.use(requireAuth)
// Every tier here spends the owner's own API key (free tier included), so an
// unapproved account must not be able to reach it — otherwise "demo only"
// would still let a stranger run up the owner's LLM bill.
llmRouter.use(requireApproved)

function parseChatBody(req: Request): { system: string; user: string } | { error: string } {
  const { system, user } = req.body ?? {}
  if (typeof system !== 'string' || typeof user !== 'string') return { error: 'system and user (strings) required' }
  return { system, user }
}

llmRouter.post('/free/chat', freeTierRateLimit, asyncHandler(async (req, res) => {
  const parsed = parseChatBody(req)
  if ('error' in parsed) {
    res.status(400).json(parsed)
    return
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Free tier is not configured on this server (missing GEMINI_API_KEY)' })
    return
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const start = Date.now()
  let usage: Usage = {}
  await pipeTextStream(res, streamGeminiChat(apiKey, parsed.system, parsed.user, model, (u) => { usage = u }))
  void logUsageEvent({
    userId: req.user!.id,
    eventType: 'llm_call',
    provider: 'gemini',
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - start,
  })
}))

// Pro tier — the owner's own ANTHROPIC_API_KEY, a better model than the free
// tier, gated on users.plan_tier (kept in sync by the billing webhook).
llmRouter.post('/pro/chat', requirePlan('pro'), asyncHandler(async (req, res) => {
  const parsed = parseChatBody(req)
  if ('error' in parsed) {
    res.status(400).json(parsed)
    return
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Pro tier is not configured on this server (missing ANTHROPIC_API_KEY)' })
    return
  }
  const model = 'claude-opus-4-8'
  const start = Date.now()
  let usage: Usage = {}
  await pipeTextStream(res, streamAnthropicChat(apiKey, parsed.system, parsed.user, model, (u) => { usage = u }))
  void logUsageEvent({
    userId: req.user!.id,
    eventType: 'llm_call',
    provider: 'anthropic-pro',
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - start,
  })
}))
