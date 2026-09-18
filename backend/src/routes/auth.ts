import { Router } from 'express'
import { googleAuthStart, googleAuthCallback } from '../auth/google.js'
import { clearSessionCookie, destroySession, requireAuth } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { eq, isNull, and } from 'drizzle-orm'

export const authRouter = Router()

authRouter.get('/google/start', googleAuthStart)
authRouter.get('/google/callback', (req, res) => {
  googleAuthCallback(req, res).catch((err) => {
    console.error('OAuth callback failed', err)
    res.status(500).send('Sign-in failed')
  })
})

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null })
})

// Ask the owner for early access. Requires a session, because the whole
// point is to attach the request to a real Google identity the owner can
// then approve — an anonymous waitlist would just be a spam funnel.
//
// Idempotent, and it never overwrites an existing timestamp: the first ask is
// the one worth recording, and letting repeat clicks bump it would let
// someone push themselves to the top of a date-sorted queue.
authRouter.post('/request-access', requireAuth, asyncHandler(async (req, res) => {
  await db
    .update(users)
    .set({ accessRequestedAt: new Date() })
    .where(and(eq(users.id, req.user!.id), isNull(users.accessRequestedAt)))
  const [row] = await db
    .select({ requestedAt: users.accessRequestedAt })
    .from(users)
    .where(eq(users.id, req.user!.id))
    .limit(1)
  res.json({ accessRequestedAt: row?.requestedAt ?? null })
}))

authRouter.post('/logout', (req, res) => {
  destroySession(req.sessionId)
    .catch((err) => console.error('Failed to destroy session', err))
    .finally(() => {
      clearSessionCookie(res)
      res.status(204).end()
    })
})
