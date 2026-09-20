// Records that someone looked at /demo.
//
// The demo has no sign-in — that is the point of it — so there is no user to
// attribute a visit to. Rather than making usage_events.user_id nullable and
// teaching every admin query about rows that belong to nobody, visits are
// attributed to one reserved account. It shows up in the admin panel like any
// other row, which is where you would look for it.
//
// This is the only unauthenticated write in the API, so it is deliberately
// narrow: no request data is stored beyond an event name from a fixed list,
// and it is rate limited per IP.
import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, usageEvents } from '../db/schema.js'
import { asyncHandler } from '../middleware/asyncHandler.js'

export const demoRouter = Router()

/** Reserved, and not a real address — .invalid is reserved by RFC 2606 and can
 *  never be registered, so this can't collide with a person signing in. */
export const DEMO_EMAIL = 'demo@rabbithole.invalid'

/** Only these can be written. An open endpoint that stored a caller-supplied
 *  string would be a free write primitive into the admin panel's own display. */
const ALLOWED_EVENTS = new Set(['demo_open', 'demo_note_open'])

// One visit per IP per window is plenty for a usage signal and puts a ceiling
// on what an open endpoint can do to the table. In memory, like the free-tier
// limiter: this is a single small instance, and losing the counter on a cold
// start costs an extra row, not correctness.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
const hits = new Map<string, { windowStart: number; count: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = hits.get(ip)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { windowStart: now, count: 1 })
    // Opportunistic sweep so a long-lived instance doesn't accumulate an
    // entry per IP forever.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.windowStart > WINDOW_MS) hits.delete(k)
    }
    return false
  }
  if (entry.count >= MAX_PER_WINDOW) return true
  entry.count++
  return false
}

/** Lazily created so a fresh database needs no seeding step, and so the row
 *  only exists once somebody has actually looked at the demo. */
async function demoUserId(): Promise<string> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1)
  if (existing[0]) return existing[0].id
  const [row] = await db
    .insert(users)
    .values({
      // Not a Google identity; this account can never be signed into, which
      // is why googleSub is a sentinel rather than anything resolvable.
      googleSub: 'demo-visitors',
      email: DEMO_EMAIL,
      displayName: 'Demo visitors',
      role: 'demo',
      emailVerified: false,
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id })
  if (row) return row.id
  // Lost a race with a concurrent first visit — read the winner's row.
  const again = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL)).limit(1)
  if (!again[0]) throw new Error('could not resolve the demo account')
  return again[0].id
}

demoRouter.post('/visit', asyncHandler(async (req, res) => {
  const event = typeof req.body?.event === 'string' ? req.body.event : 'demo_open'
  if (!ALLOWED_EVENTS.has(event)) {
    res.status(400).json({ error: 'unknown event' })
    return
  }

  // Trust the platform's forwarded-for, not a caller-set header alone: on
  // Vercel the left-most entry is the real client.
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || 'unknown'

  // Answer the same either way. A visit counter is not worth telling a
  // caller how the limiter behaves.
  res.status(202).json({ ok: true })
  if (rateLimited(ip)) return

  try {
    const userId = await demoUserId()
    // last_login_at doubles as "last seen" for this account, which is what
    // puts it in the admin sign-ins view alongside real users.
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
    await db.insert(usageEvents).values({ userId, eventType: event })
  } catch (err) {
    console.warn('[demo] could not record visit:', err)
  }
}))
