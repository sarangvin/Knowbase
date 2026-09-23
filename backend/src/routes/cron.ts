// Scheduled work, triggered by Vercel Cron.
//
// Mounted outside the authenticated routers because the caller is a schedule,
// not a person. That makes the guard below the only thing standing between a
// stranger and the shared model quota, so it fails closed: with no
// CRON_SECRET configured this route refuses everybody, including the
// scheduler. A route that is open because a variable is unset is how a free
// tier gets drained by a crawler.
import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { topUpEveryone, findShortCollections, shelfReport, passDiagnostics } from '../onboarding/topUp.js'

export const cronRouter = Router()

/** Vercel sends `Authorization: Bearer $CRON_SECRET` on every scheduled
 *  invocation when that variable is set on the project. The owner can also
 *  trigger a pass by hand from the admin panel, which goes through the
 *  authenticated admin router instead — not this one. */
function authorised(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return header === `Bearer ${secret}`
}

/**
 * Top every collection back up to three unreviewed topics.
 *
 * GET because that is what Vercel Cron sends. It is not idempotent in the
 * strict sense — it writes notes — but it is self-limiting: a collection
 * already at the threshold is excluded by the query, so running it twice in
 * a row does nothing the second time.
 */
cronRouter.get('/top-up', asyncHandler(async (req, res) => {
  if (!authorised(req.headers.authorization)) {
    // 404 rather than 401: an unauthenticated caller learns nothing about
    // whether this path exists.
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json(await topUpEveryone())
}))

/** What the next pass would do, without doing it. Same guard, no spend —
 *  useful for checking the schedule is wired up before trusting it with the
 *  quota. */
cronRouter.get('/top-up/preview', asyncHandler(async (req, res) => {
  if (!authorised(req.headers.authorization)) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const candidates = await findShortCollections(20)
  // Both shelves, per collection. "Short" alone cannot tell you whether the
  // buffer behind it is full, empty or full of stubs, and those need three
  // different fixes.
  res.json({
    candidates: candidates.map((c) => ({ space: c.space, unreviewed: c.unreviewed })),
    shelves: await shelfReport(60),
    diagnostics: await passDiagnostics(),
    // Echoed so a deployment that was *rejected* is visible from outside.
    // Vercel refuses the whole deployment over an unsupported maxDuration —
    // it does not fall back — and the symptom is the old build quietly
    // staying live, which this repo has already been caught by once with a
    // sub-daily cron entry.
    maxDurationS: 240,
  })
}))
