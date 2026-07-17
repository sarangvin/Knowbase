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

const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function createApp() {
  const app = express()

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests (no Origin header, e.g. curl/server-to-server) are allowed.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
        callback(new Error('Not allowed by CORS'))
      },
      credentials: true,
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
