import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { attachUser } from './auth/session.js'
import { asyncHandler } from './middleware/asyncHandler.js'
import { authRouter } from './routes/auth.js'
import { vaultsRouter } from './routes/vaults.js'
import { settingsRouter } from './routes/settings.js'
import { llmRouter } from './routes/llm.js'
import { billingRouter, billingWebhookHandler } from './routes/billing.js'
import { adminRouter } from './routes/admin.js'
import { draftNotesRouter } from './routes/draftNotes.js'
import { onboardingRouter } from './routes/onboarding.js'
import { demoRouter } from './routes/demo.js'

const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function createApp() {
  const app = express()

  // A missing Origin header does NOT mean same-origin — that was the original
  // assumption here and it was wrong in the one case that matters. Browsers
  // omit Origin on same-origin GETs but DO send it on same-origin POSTs, so
  // with CORS_ORIGINS empty (correct for this single-origin deployment) every
  // POST from our own frontend was rejected. Reads worked, writes and LLM
  // calls 500'd with "Internal server error" and no mention of CORS.
  //
  // Same-origin is decided by comparing the Origin's host to the request's
  // own Host, which needs the request — hence the delegate form.
  app.use(
    cors((req: express.Request, callback: (err: Error | null, options?: cors.CorsOptions) => void) => {
      const origin = req.headers.origin
      if (!origin) return callback(null, { origin: true, credentials: true })

      let sameOrigin = false
      try {
        sameOrigin = new URL(origin).host === req.headers.host
      } catch {
        sameOrigin = false // unparseable Origin — treat as untrusted
      }

      if (sameOrigin || allowedOrigins.includes(origin)) {
        return callback(null, { origin: true, credentials: true })
      }
      // Reply without CORS headers rather than throwing. Throwing surfaced as
      // a 500 "Internal server error", which says nothing about the actual
      // cause; withholding the headers is what the browser expects and lets
      // it report a real CORS failure in the console. Cross-site requests
      // can't carry the session cookie anyway — it's SameSite=Lax.
      callback(null, { origin: false })
    }),
  )
  app.use(cookieParser())

  // Mounted BEFORE express.json(): signature verification needs the exact
  // raw bytes Razorpay signed, not a re-serialized parsed body.
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    billingWebhookHandler(req, res).catch((err) => {
      console.error('Billing webhook failed', err)
      res.status(500).send('error')
    })
  })

  app.use(express.json({ limit: '2mb' })) // notes are small markdown files; 2mb is generous headroom
  app.use(asyncHandler(attachUser))

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/auth', authRouter)
  app.use('/api/vaults', vaultsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/llm', llmRouter)
  app.use('/api/billing', billingRouter)
  app.use('/api/admin', adminRouter)
  // Unauthenticated by design — see routes/demo.ts.
  app.use('/api/demo', demoRouter)
  app.use('/api/draft-notes', draftNotesRouter)
  app.use('/api/onboarding', onboardingRouter)

  // Last: catches anything asyncHandler forwarded (or any sync throw) so a
  // bug in one request returns a clean 500 instead of taking the process down.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err)
      return
    }
    console.error('Unhandled request error', err)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
