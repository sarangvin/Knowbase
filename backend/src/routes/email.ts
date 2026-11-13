// Unsubscribe, from the link at the foot of every email and from the mail
// client's own one-click button (List-Unsubscribe-Post, RFC 8058).
//
// GET shows a page with one button; POST does it. A GET that unsubscribed by
// itself would be triggered by mail scanners that open every link in a
// message, opting people out who never clicked. No sign-in needed: the
// signed token in the link is the proof.
import { Router } from 'express'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { validUnsubToken } from '../email/send.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const emailRouter = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function params(q: Record<string, unknown>): { u: string; t: string } | null {
  const u = typeof q.u === 'string' ? q.u : ''
  const t = typeof q.t === 'string' ? q.t : ''
  return UUID.test(u) && validUnsubToken(u, t) ? { u, t } : null
}

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rabbithole emails</title></head>
<body style="margin:0;padding:48px 16px;background:#f6f4ef;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:center">${body}</div></body></html>`
}

emailRouter.get('/unsubscribe', (req, res) => {
  const p = params(req.query)
  if (!p) {
    res.status(400).send(page('<p>This unsubscribe link is not valid.</p>'))
    return
  }
  res.send(
    page(`<p style="font-size:17px">Stop getting emails from Rabbithole?</p>
<form method="post" action="/api/email/unsubscribe?u=${p.u}&t=${encodeURIComponent(p.t)}">
<button style="font-size:16px;padding:12px 22px;border:0;border-radius:8px;background:#222;color:#fff;cursor:pointer">Unsubscribe</button>
</form>`),
  )
})

emailRouter.post('/unsubscribe', asyncHandler(async (req, res) => {
  const p = params(req.query)
  if (!p) {
    res.status(400).send(page('<p>This unsubscribe link is not valid.</p>'))
    return
  }
  const changed = await db
    .update(users)
    .set({ emailOptedOutAt: new Date() })
    .where(and(eq(users.id, p.u), isNull(users.emailOptedOutAt)))
    .returning({ id: users.id })
  if (changed.length) await logUsageEvent({ userId: p.u, eventType: 'email_unsubscribe' })
  res.send(page('<p style="font-size:17px">Done. You won\'t get any more emails from Rabbithole.</p><p><a href="/" style="color:#555">Back to the app</a></p>'))
}))
