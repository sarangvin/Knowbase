// Client for /api/billing/* — subscribe/cancel only ever ask the backend to
// talk to Razorpay; the resulting plan state change lands asynchronously via
// the Razorpay webhook, not synchronously in these responses.
export interface SubscriptionStatus {
  status: string
  planTier: 'free' | 'pro'
  currentPeriodEnd: string | null
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await fetch('/api/billing/subscription', { credentials: 'include' })
  if (!res.ok) throw new Error(`Could not load subscription status: ${res.status}`)
  return res.json()
}

export async function startSubscribe(): Promise<{ subscriptionId: string; keyId: string }> {
  const res = await fetch('/api/billing/subscribe', { method: 'POST', credentials: 'include' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `Could not start checkout: ${res.status}`)
  }
  return res.json()
}

export async function cancelSubscription(): Promise<void> {
  const res = await fetch('/api/billing/cancel', { method: 'POST', credentials: 'include' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `Could not cancel: ${res.status}`)
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

function loadCheckoutScript(): Promise<void> {
  if (document.querySelector(`script[src="${CHECKOUT_SRC}"]`)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout'))
    document.head.appendChild(script)
  })
}

interface RazorpayCheckoutOptions {
  key: string
  subscription_id: string
  name: string
  description: string
  theme?: { color?: string }
  handler: () => void
  modal?: { ondismiss?: () => void }
}
declare global {
  interface Window {
    Razorpay: new (opts: RazorpayCheckoutOptions) => { open(): void }
  }
}

/** Opens Razorpay's hosted Checkout modal (Google Pay appears automatically
 * as a payment method there for supported devices — no separate integration). */
export async function openCheckout(opts: {
  subscriptionId: string
  keyId: string
  onSuccess: () => void
  onDismiss?: () => void
}): Promise<void> {
  await loadCheckoutScript()
  const rzp = new window.Razorpay({
    key: opts.keyId,
    subscription_id: opts.subscriptionId,
    name: 'KnowBase Pro',
    description: 'Monthly subscription — better AI model',
    theme: { color: '#6366f1' },
    handler: opts.onSuccess,
    modal: { ondismiss: opts.onDismiss },
  })
  rzp.open()
}
