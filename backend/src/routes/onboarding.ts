// The three calls the client needs now that it no longer generates anything:
// start a space, ask whether it is ready, and say it has been seen.
//
// Behind requireApproved like the rest of the cloud routes — generation spends
// the owner's own model key, so an unapproved account must not be able to
// reach it. That is also why the landing screen's unapproved path files an
// access request instead of calling start: they get the demo space and no
// notification, because nothing is being built for them, and implying
// otherwise would be worse than the honest wall.
import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { waitUntil } from '@vercel/functions'
import { db } from '../db/client.js'
import { onboardingJobs } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { runOnboarding } from '../onboarding/run.js'
import { growSpace, MAX_UNREVIEWED } from '../onboarding/grow.js'
import { drainQueue, queueDepth, reconcileQueue } from '../onboarding/queue.js'

export const onboardingRouter = Router()
onboardingRouter.use(requireAuth)
onboardingRouter.use(requireApproved)

const MAX_TOPIC_LEN = 200

export interface OnboardingJobView {
  topic: string
  status: 'running' | 'ready' | 'failed'
  space: string | null
  openPath: string | null
  error: string | null
  notesTotal: number
  notesDrafted: number
  acknowledged: boolean
}

async function currentJob(userId: string): Promise<OnboardingJobView | null> {
  const rows = await db.select().from(onboardingJobs).where(eq(onboardingJobs.userId, userId)).limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    topic: row.topic,
    status: row.status as OnboardingJobView['status'],
    space: row.space,
    openPath: row.openPath,
    error: row.error,
    notesTotal: row.notesTotal,
    notesDrafted: row.notesDrafted,
    acknowledged: row.acknowledgedAt !== null,
  }
}

/** Start building a space. Returns immediately; the work continues under
 *  waitUntil so closing the tab, locking the phone or switching apps doesn't
 *  abort it — which is the entire point of moving this off the client. */
onboardingRouter.post('/start', asyncHandler(async (req, res) => {
  const raw = typeof req.body?.topic === 'string' ? req.body.topic.trim() : ''
  if (!raw || raw.length > MAX_TOPIC_LEN) {
    res.status(400).json({ error: `body.topic (1-${MAX_TOPIC_LEN} chars) required` })
    return
  }
  const userId = req.user!.id

  // A job already running is left alone: double-submitting the form, or a
  // reload landing back on the landing screen, must not start a second
  // generation spending a second set of model calls on the same person.
  const existing = await currentJob(userId)
  if (existing?.status === 'running') {
    res.status(202).json({ job: existing })
    return
  }

  // Upsert: a retry after a failure, or a different topic, replaces the row.
  // There is one first-run job per user, so a history here would only raise
  // the question of which row the notification means.
  await db
    .insert(onboardingJobs)
    .values({ userId, topic: raw, status: 'running', notesTotal: 0, notesDrafted: 0 })
    .onConflictDoUpdate({
      target: onboardingJobs.userId,
      set: {
        topic: raw,
        status: 'running',
        space: null,
        openPath: null,
        error: null,
        notesTotal: 0,
        notesDrafted: 0,
        acknowledgedAt: null,
        updatedAt: new Date(),
      },
    })

  res.status(202).json({ job: await currentJob(userId) })

  waitUntil(runOnboarding(userId, raw))
}))

/** Top a space back up after a note is marked reviewed.
 *
 *  Answers immediately and grows under waitUntil: the caller is a button that
 *  has already done its real work (writing the review date), so this must not
 *  add latency to it, and must not be able to fail it either.
 *
 *  Idempotent by construction rather than by locking — growSpace counts the
 *  unreviewed topics that actually exist each time, so a double click finds
 *  the cap already met and does nothing. */
onboardingRouter.post('/grow', asyncHandler(async (req, res) => {
  const space = typeof req.body?.space === 'string' ? req.body.space.trim() : ''
  // No slashes: this is one path segment, and a crafted value must not be
  // able to reach outside the space's own folder.
  if (!space || space.length > 80 || space.includes('/')) {
    res.status(400).json({ error: 'body.space (a single space name) required' })
    return
  }
  const userId = req.user!.id
  res.status(202).json({ ok: true, maxUnreviewed: MAX_UNREVIEWED })
  waitUntil(growSpace(userId, space))
}))

/** The job's state, and the heartbeat that keeps the draft queue moving.
 *
 *  There is no long-running worker to put the queue on — the backend is a
 *  serverless function — so something has to notice pending work and start
 *  on it. This poll already runs every five seconds while a space is being
 *  built, which makes it the natural pulse. The drain claims rows atomically,
 *  so several clients polling at once is wasteful at worst, never harmful.
 *
 *  Deliberately after the response: the poll must stay instant. */
onboardingRouter.get('/status', asyncHandler(async (req, res) => {
  const job = await currentJob(req.user!.id)
  const depth = await queueDepth()
  res.json({ job, queue: depth })
  if (depth.pending > 0 || depth.running > 0) waitUntil(drainQueue())
}))

/** Sweep for work the queue has lost track of, then drain.
 *
 *  Separate from the poll because it scans notes rather than the queue, which
 *  is too heavy to do every five seconds. Safe to call from anywhere — a
 *  scheduled ping, or by hand after a deploy that fixed whatever was
 *  breaking the drafts. */
onboardingRouter.post('/queue/sweep', asyncHandler(async (req, res) => {
  const reconciled = await reconcileQueue()
  const drained = await drainQueue()
  res.json({ reconciled, drained, depth: await queueDepth() })
}))

/** Called once the user has actually been taken to their new space, so the
 *  notification fires once instead of on every load for the rest of time. */
onboardingRouter.post('/ack', asyncHandler(async (req, res) => {
  await db
    .update(onboardingJobs)
    .set({ acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(onboardingJobs.userId, req.user!.id))
  res.json({ ok: true })
}))
