// Opting in and out of the daily reminders (notifications/run.ts).
//
// Opting in is two facts that must both hold before anything is sent: the
// account's switch is on, and this device has a push subscription. Opting
// out turns the switch off and forgets every device, so a stale subscription
// can never outlive the person's "no".
import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, pushSubscriptions } from '../db/schema.js'
import { requireAuth } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { pushConfigured, sendToUser } from '../notifications/run.js'

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

function validZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const [u] = await db
    .select({ enabled: users.notificationsEnabled })
    .from(users)
    .where(eq(users.id, req.user!.id))
    .limit(1)
  res.json({
    enabled: u?.enabled ?? false,
    // The browser needs this to subscribe; null means the server cannot send.
    publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
  })
}))

/** Body: { subscription: PushSubscriptionJSON, timezone: string } */
notificationsRouter.post('/subscribe', asyncHandler(async (req, res) => {
  const sub = req.body?.subscription
  const endpoint = sub?.endpoint
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
    res.status(400).json({ error: 'a push subscription is required' })
    return
  }
  const userId = req.user!.id
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh, auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh, auth } })
  await db
    .update(users)
    .set({
      notificationsEnabled: true,
      notificationsEnabledAt: new Date(),
      notifyTimezone: validZone(req.body?.timezone),
      lastSeenAt: new Date(),
    })
    .where(eq(users.id, userId))
  res.json({ enabled: true })
}))

notificationsRouter.post('/unsubscribe', asyncHandler(async (req, res) => {
  const userId = req.user!.id
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  await db.update(users).set({ notificationsEnabled: false }).where(eq(users.id, userId))
  res.json({ enabled: false })
}))

/** A test notification to the caller's own devices, from Settings. */
notificationsRouter.post('/test', asyncHandler(async (req, res) => {
  if (!pushConfigured()) {
    res.status(503).json({ error: 'notifications are not configured on the server' })
    return
  }
  const delivered = await sendToUser(req.user!.id, {
    title: 'Notifications are on 🐇',
    body: 'This is what a reminder looks like. You will get at most one a day, and they stop if you have not opened the app in a week.',
  })
  res.json({ delivered })
}))
