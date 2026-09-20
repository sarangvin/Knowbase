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

onboardingRouter.get('/status', asyncHandler(async (req, res) => {
  res.json({ job: await currentJob(req.user!.id) })
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
