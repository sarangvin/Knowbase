import { Router } from 'express'
import { googleAuthStart, googleAuthCallback } from '../auth/google.js'
import { clearSessionCookie, destroySession } from '../auth/session.js'

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

authRouter.post('/logout', (req, res) => {
  destroySession(req.sessionId)
    .catch((err) => console.error('Failed to destroy session', err))
    .finally(() => {
      clearSessionCookie(res)
      res.status(204).end()
    })
})
