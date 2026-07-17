import Razorpay from 'razorpay'
import { createHmac, timingSafeEqual } from 'node:crypto'

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

let client: Razorpay | null = null
export function razorpay(): Razorpay {
  if (!client) {
    client = new Razorpay({ key_id: requiredEnv('RAZORPAY_KEY_ID'), key_secret: requiredEnv('RAZORPAY_KEY_SECRET') })
  }
  return client
}

/** Create a Razorpay Customer for a user who doesn't have one yet. */
export async function createCustomer(email: string, name: string | null): Promise<string> {
  const customer = await razorpay().customers.create({ email, name: name ?? email, fail_existing: 0 })
  return customer.id
}

/** Start a subscription against the pre-created Pro plan (RAZORPAY_PLAN_ID, set up once in the Razorpay dashboard). */
export async function createSubscription(customerId: string): Promise<{ id: string }> {
  const planId = requiredEnv('RAZORPAY_PLAN_ID')
  const sub = await razorpay().subscriptions.create({
    plan_id: planId,
    customer_notify: 1,
    total_count: 120, // ~10 years of monthly cycles; Razorpay requires a bound, this is effectively "until cancelled"
    notes: { customer_id: customerId },
  })
  return { id: sub.id }
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await razorpay().subscriptions.cancel(subscriptionId)
}

/** Verifies X-Razorpay-Signature: HMAC-SHA256(rawBody, webhook secret), hex. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = requiredEnv('RAZORPAY_WEBHOOK_SECRET')
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
