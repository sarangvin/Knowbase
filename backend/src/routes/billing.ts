// subscriptions is the source of truth for plan state, written ONLY by
// billingWebhookHandler — /subscribe and /cancel only ask Razorpay to
// start/stop a subscription, they never set status or planTier themselves.
import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { subscriptions, users } from '../db/schema.js'
import { requireAuth } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { createCustomer, createSubscription, cancelSubscription, verifyWebhookSignature } from '../billing/razorpay.js'

export const billingRouter = Router()
billingRouter.use(requireAuth)

async function getOrCreateSubscriptionRow(userId: string, email: string, displayName: string | null) {
  const existing = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)
  if (existing[0]) return existing[0]
  const customerId = await createCustomer(email, displayName)
  const [row] = await db.insert(subscriptions).values({ userId, razorpayCustomerId: customerId }).returning()
  return row
}

billingRouter.get('/subscription', asyncHandler(async (req, res) => {
  const existing = await db
    .select({ status: subscriptions.status, planTier: subscriptions.planTier, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, req.user!.id))
    .limit(1)
  res.json(existing[0] ?? { status: 'none', planTier: 'free', currentPeriodEnd: null })
}))

billingRouter.post('/subscribe', asyncHandler(async (req, res) => {
  const row = await getOrCreateSubscriptionRow(req.user!.id, req.user!.email, req.user!.displayName)
  const { id: subscriptionId } = await createSubscription(row.razorpayCustomerId)
  await db
    .update(subscriptions)
    .set({ razorpaySubscriptionId: subscriptionId, updatedAt: new Date() })
    .where(eq(subscriptions.userId, req.user!.id))
  res.json({ subscriptionId, keyId: process.env.RAZORPAY_KEY_ID })
}))

billingRouter.post('/cancel', asyncHandler(async (req, res) => {
  const existing = await db
    .select({ razorpaySubscriptionId: subscriptions.razorpaySubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, req.user!.id))
    .limit(1)
  if (!existing[0]?.razorpaySubscriptionId) {
    res.status(400).json({ error: 'No active subscription to cancel' })
    return
  }
  await cancelSubscription(existing[0].razorpaySubscriptionId)
  res.status(202).json({ message: 'Cancellation requested — this updates once Razorpay confirms it.' })
}))

// ── Webhook: mounted separately in app.ts with express.raw(), BEFORE the
// global express.json() body parser, since signature verification needs the
// exact raw bytes Razorpay signed. ────────────────────────────────────────
interface RazorpaySubscriptionEntity {
  id: string
  status: string
  current_end?: number
}
interface RazorpayWebhookPayload {
  event: string
  payload: { subscription?: { entity: RazorpaySubscriptionEntity } }
}

const PRO_EVENTS = new Set(['subscription.activated', 'subscription.charged'])
const FREE_EVENTS = new Set(['subscription.cancelled', 'subscription.completed', 'subscription.expired'])

export async function billingWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature']
  if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
    res.status(400).send('bad request')
    return
  }
  if (!verifyWebhookSignature(req.body, signature)) {
    res.status(401).send('invalid signature')
    return
  }

  let body: RazorpayWebhookPayload
  try {
    body = JSON.parse(req.body.toString('utf8'))
  } catch {
    res.status(400).send('invalid json')
    return
  }

  const entity = body.payload.subscription?.entity
  if (!entity) {
    res.status(200).send('ignored: no subscription entity')
    return
  }

  const existing = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.razorpaySubscriptionId, entity.id))
    .limit(1)
  if (!existing[0]) {
    res.status(200).send('ignored: unknown subscription')
    return
  }

  const planTier = PRO_EVENTS.has(body.event) ? 'pro' : FREE_EVENTS.has(body.event) ? 'free' : null
  const currentPeriodEnd = entity.current_end ? new Date(entity.current_end * 1000) : null

  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ status: entity.status, ...(planTier ? { planTier } : {}), currentPeriodEnd, updatedAt: new Date() })
      .where(eq(subscriptions.userId, existing[0].userId))
    if (planTier) {
      await tx.update(users).set({ planTier }).where(eq(users.id, existing[0].userId))
    }
  })

  res.status(200).send('ok')
}
