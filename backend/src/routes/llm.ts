import { Router, type Request } from 'express'
import type { Response, NextFunction } from 'express'
import { requireAuth } from '../auth/session.js'
import { requirePlan } from '../middleware/requirePlan.js'
import { limitsFor, tierOf, isUnlimited } from '../plans.js'
import { askAiLast24h, newAccountBudgetSpent, NEW_ACCOUNT_BUDGET_MESSAGE } from '../usage/allowance.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { streamAnthropicChat, type Usage } from '../llm/providers/anthropic.js'
import { streamGeminiWithFallback } from '../llm/meter.js'
import { primaryModel } from '../llm/models.js'
import { pipeTextStream } from '../llm/proxy.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const llmRouter = Router()
llmRouter.use(requireAuth)
// Every tier here spends the owner's own API key. It used to be closed to
// unapproved accounts outright; it is now open to every signed-in account and
// bounded instead — per account by askAiPerDay, and for new accounts as a
// group by the shared allowance in plans.ts.

/** The per-tier Ask AI limit, counted from the usage log over a rolling 24
 *  hours. It replaced an in-memory counter, which on serverless reset with
 *  every cold instance and so limited very little. */
async function askAiLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tier = tierOf(req.user!)
    const limit = limitsFor(tier).askAiPerDay
    if (!isUnlimited(limit) && (await askAiLast24h(req.user!.id)) >= limit) {
      res.status(429).json({
        error: `That's ${limit} Ask AI messages in the last day, the most ${tier === 'new' ? 'for new accounts' : 'on the free plan'}. Try again tomorrow, or add your own API key in Settings.`,
      })
      return
    }
    // This route streams straight from the provider rather than through the
    // meter, so the shared new-account allowance is checked here instead.
    if (tier === 'new' && (await newAccountBudgetSpent())) {
      res.status(429).json({ error: NEW_ACCOUNT_BUDGET_MESSAGE })
      return
    }
    next()
  } catch (err) {
    next(err)
  }
}

function parseChatBody(req: Request): { system: string; user: string } | { error: string } {
  const { system, user } = req.body ?? {}
  if (typeof system !== 'string' || typeof user !== 'string') return { error: 'system and user (strings) required' }
  return { system, user }
}

llmRouter.post('/free/chat', askAiLimit, asyncHandler(async (req, res) => {
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
  const start = Date.now()
  let usage: Usage = {}
  let model = primaryModel()
  let fellBackFrom: string[] = []
  await pipeTextStream(
    res,
    streamGeminiWithFallback(apiKey, parsed.system, parsed.user, (u) => { usage = u }, (m, skipped) => {
      model = m
      fellBackFrom = skipped
    }),
  )
  void logUsageEvent({
    userId: req.user!.id,
    eventType: 'llm_call',
    provider: 'gemini',
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - start,
    // What askAiLimit counts.
    metadata: fellBackFrom.length ? { source: 'ask-ai', fellBackFrom } : { source: 'ask-ai' },
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
