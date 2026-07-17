import { Router, type Request } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { apiKeys } from '../db/schema.js'
import { requireAuth } from '../auth/session.js'
import { requirePlan } from '../middleware/requirePlan.js'
import { freeTierRateLimit } from '../middleware/rateLimit.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { decryptSecret } from '../security/crypto.js'
import { streamAnthropicChat, type Usage } from '../llm/providers/anthropic.js'
import { streamGeminiChat, DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { pipeTextStream } from '../llm/proxy.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const llmRouter = Router()
llmRouter.use(requireAuth)

function parseChatBody(req: Request): { system: string; user: string } | { error: string } {
  const { system, user } = req.body ?? {}
  if (typeof system !== 'string' || typeof user !== 'string') return { error: 'system and user (strings) required' }
  return { system, user }
}

// BYO tier — proxied (not called directly from the browser) so every call,
// regardless of whose key pays for it, flows through this same logging point.
llmRouter.post('/anthropic/chat', asyncHandler(async (req, res) => {
  const parsed = parseChatBody(req)
  if ('error' in parsed) {
    res.status(400).json(parsed)
    return
  }
  const row = await db
    .select({ ciphertext: apiKeys.ciphertext, nonce: apiKeys.nonce })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, req.user!.id), eq(apiKeys.provider, 'anthropic')))
    .limit(1)
  if (!row[0]) {
    res.status(400).json({ error: 'No Anthropic API key saved — add one in Settings' })
    return
  }
  const apiKey = decryptSecret(row[0])
  const model = 'claude-opus-4-8'
  const start = Date.now()
  let usage: Usage = {}
  await pipeTextStream(res, streamAnthropicChat(apiKey, parsed.system, parsed.user, model, (u) => { usage = u }))
  void logUsageEvent({
    userId: req.user!.id,
    eventType: 'llm_call',
    provider: 'anthropic',
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - start,
  })
}))

// Free tier — always the owner's own GEMINI_API_KEY, rate-limited per user.
// Model name is env-configurable (GEMINI_MODEL) rather than hardcoded: we
// just got burned by Groq deprecating gemma2-9b-it out of their catalog
// entirely, so a provider-side model rename/deprecation here shouldn't need
// a code change to recover from.
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
