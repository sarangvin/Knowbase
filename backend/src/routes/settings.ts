import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { apiKeys } from '../db/schema.js'
import { requireAuth } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { encryptSecret } from '../security/crypto.js'

export const settingsRouter = Router()
settingsRouter.use(requireAuth)

const SUPPORTED_PROVIDERS = new Set(['anthropic'])

settingsRouter.get('/keys', asyncHandler(async (req, res) => {
  const rows = await db
    .select({ provider: apiKeys.provider, lastFour: apiKeys.lastFour, updatedAt: apiKeys.updatedAt })
    .from(apiKeys)
    .where(eq(apiKeys.userId, req.user!.id))
  res.json(rows.map((r) => ({ provider: r.provider, lastFour: r.lastFour, updatedAt: r.updatedAt })))
}))

settingsRouter.post('/keys', asyncHandler(async (req, res) => {
  const { provider, apiKey } = req.body ?? {}
  if (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.has(provider)) {
    res.status(400).json({ error: `provider must be one of: ${[...SUPPORTED_PROVIDERS].join(', ')}` })
    return
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    res.status(400).json({ error: 'apiKey is required' })
    return
  }
  const trimmed = apiKey.trim()
  const { ciphertext, nonce } = encryptSecret(trimmed)
  const lastFour = trimmed.slice(-4)

  await db
    .insert(apiKeys)
    .values({ userId: req.user!.id, provider, ciphertext, nonce, lastFour })
    .onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: { ciphertext, nonce, lastFour, updatedAt: new Date() },
    })
  res.status(200).json({ provider, lastFour })
}))

settingsRouter.delete('/keys/:provider', asyncHandler(async (req, res) => {
  await db.delete(apiKeys).where(and(eq(apiKeys.userId, req.user!.id), eq(apiKeys.provider, req.params.provider)))
  res.status(204).end()
}))
