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
import { eq, sql } from 'drizzle-orm'
import { waitUntil } from '@vercel/functions'
import { db } from '../db/client.js'
import { onboardingJobs } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { runOnboarding } from '../onboarding/run.js'
import { growSpace, MAX_UNREVIEWED } from '../onboarding/grow.js'
import { drainQueue, queueDepth, reconcileQueue } from '../onboarding/queue.js'
import { ensureStocked } from '../onboarding/ensure.js'
import { collectionAllowance, recordCollectionStart } from '../onboarding/limits.js'
import { getOrCreatePersonalVaultId, archivedSpaces } from '../vault/spaces.js'
import { revealUpTo } from '../vault/hidden.js'

export const onboardingRouter = Router()
onboardingRouter.use(requireAuth)
onboardingRouter.use(requireApproved)

const MAX_TOPIC_LEN = 200

/** How long a job may sit on 'running' without progress before we call it
 *  dead.
 *
 *  A whole run — plan plus five drafts — is ~25s measured, and every step
 *  patches the row on its way through, so two minutes of silence is not a
 *  slow run: it is an invocation that is not coming back. That happens. The
 *  work runs under `waitUntil` after the response has been sent, and a
 *  deployment cutover or a hard kill takes it with no error to catch and
 *  nothing written down.
 *
 *  Without this the row is wedged: nothing reclaims a stale 'running' job the
 *  way the draft queue reclaims its own, and /start refuses to act while one
 *  is running — so the spinner never resolves and "Try again" silently does
 *  nothing. One killed invocation ended onboarding for that account
 *  permanently. */
const STALE_JOB_MS = 2 * 60_000

/** What one invocation may spend on background work, against the 60s
 *  maxDuration in vercel.json. The slack is the response, the queries either
 *  side, and the platform's own overhead — a deadline set at the ceiling is
 *  not a deadline. */
const INVOCATION_BUDGET_MS = 50_000

/** Local YYYY-MM-DD as the client keeps it — the same day the review cap,
 *  the quiz, the flashcard deck and the question allowance all use. */
function dayOf(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

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

/** How many of a space's topic notes actually hold a draft, straight from the
 *  notes table. The placeholder sentence is the same one queue.ts tests for —
 *  "has this note been written yet?" has one answer, in one place, however
 *  many paths write the notes. */
async function draftedCount(userId: string, space: string): Promise<{ drafted: number; total: number }> {
  const prefix = `${'Automated Graph/'}${space}/Topics/`
  const rows = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (
             WHERE n.content NOT LIKE '%fuller draft of this note is being written%'
           )::int AS drafted
    FROM notes n
    JOIN vaults v ON v.id = n.vault_id
    WHERE v.owner_user_id = ${userId} AND v.kind = 'personal'
      AND starts_with(n.path, ${prefix})
  `)
  const r = rows.rows[0] as { total: number; drafted: number }
  return { drafted: r?.drafted ?? 0, total: r?.total ?? 0 }
}

async function currentJob(userId: string): Promise<OnboardingJobView | null> {
  const rows = await db.select().from(onboardingJobs).where(eq(onboardingJobs.userId, userId)).limit(1)
  const row = rows[0]
  if (!row) return null

  // Reported, not written back. The row keeps saying 'running' and the reader
  // is told 'failed', which is the honest answer to both questions this
  // function serves: the banner gets a state it can offer a retry from, and
  // /start below stops refusing. Writing it back would need this read path to
  // take a write, and there is nothing it would buy — the next /start
  // overwrites the row anyway.
  const stale =
    row.status === 'running' && Date.now() - row.updatedAt.getTime() > STALE_JOB_MS

  // A stale job that already has a space and a landing note is not failed —
  // it built the space and died before saying so. Calling that failed offers
  // a "Try again" that would generate the whole thing a second time under a
  // disambiguated name, which is worse than the state it is recovering from.
  // Ready is the truthful answer, and the queue finishes the notes.
  const salvageable = stale && !!row.space && !!row.openPath

  // Counted, not remembered. Only the landing note is drafted in the run
  // itself; the rest are written by the queue, which has no business writing
  // to this table. A stored counter would need every writer to keep it in
  // step, and the thing it counts is already on disk.
  const progress = row.space ? await draftedCount(userId, row.space) : null

  return {
    topic: row.topic,
    status: salvageable ? 'ready' : stale ? 'failed' : (row.status as OnboardingJobView['status']),
    error: stale && !salvageable
      ? 'Generation stopped before it finished — nothing was lost, but it needs starting again.'
      : row.error,
    space: row.space,
    openPath: row.openPath,
    notesTotal: progress?.total || row.notesTotal,
    notesDrafted: progress ? progress.drafted : row.notesDrafted,
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
  //
  // "Running" here means running *and recently alive* — currentJob reports a
  // job with no progress for STALE_JOB_MS as failed, so a killed invocation
  // no longer blocks the retry it needs.
  const existing = await currentJob(userId)
  if (existing?.status === 'running') {
    res.status(202).json({ job: existing })
    return
  }

  // Checked here, before anything is written, because this is the only door
  // that creates a collection — adoption from the corpus happens inside the
  // run below, so it is covered too. A day the client supplies, like every
  // other limit in this app; the alternative is a fourth definition of what
  // a day is.
  const day = dayOf(req.body?.day)
  const vaultId = await getOrCreatePersonalVaultId(userId)
  const allowance = await collectionAllowance(userId, vaultId, day ?? '', req.user!.planTier)
  if (allowance.blocked) {
    res.status(429).json({
      error: allowance.blocked,
      activeCount: allowance.activeCount,
      startedToday: allowance.startedToday,
      limits: allowance.limits,
    })
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

  if (day) await recordCollectionStart(userId, raw, day)

  res.status(202).json({ job: await currentJob(userId) })

  waitUntil(runOnboarding(userId, raw))
}))

/** What the caller may still start today. The home screen can work the
 *  active count out from the vault it already holds, but not the daily one,
 *  and a launcher that accepts a topic and then refuses it is worse than one
 *  that says so up front. */
onboardingRouter.get('/allowance', asyncHandler(async (req, res) => {
  const day = dayOf(req.query.day) ?? ''
  const vaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const a = await collectionAllowance(req.user!.id, vaultId, day, req.user!.planTier)
  // An unlimited limit is Infinity, and JSON.stringify turns that into null
  // silently — so the client would read "no limit" as the number zero and
  // count down from it. Say null on purpose, and document that it means
  // unlimited, rather than relying on an accident of serialisation.
  res.json({
    ...a,
    limits: {
      active: Number.isFinite(a.limits.active) ? a.limits.active : null,
      perDay: Number.isFinite(a.limits.perDay) ? a.limits.perDay : null,
    },
  })
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
  // Fixed at the top of the request, before any of the work: the drain has
  // to know how much of the invocation the plan before it already spent,
  // and it cannot work that out from its own start time.
  const deadline = Date.now() + INVOCATION_BUDGET_MS

  // The reveal happens *in* the request, before the response, because it is
  // a single UPDATE against a note that already exists — there is nothing to
  // wait for. That is the whole point of the buffer: the shelf refills now,
  // and the model call that replaces what was taken happens afterwards with
  // nobody watching.
  const vaultId = await getOrCreatePersonalVaultId(userId)
  const revealed = (await archivedSpaces(vaultId)).has(space)
    ? []
    : await revealUpTo(vaultId, space)

  res.status(202).json({ ok: true, maxUnreviewed: MAX_UNREVIEWED, revealed })
  // Plan the topics, then take one draft off the queue — one, because the
  // batch is one, so the worst case here is a plan call plus a single draft
  // rather than the plan plus three that used to overrun the 60s ceiling.
  // If the plan ate the budget the drain declines and the poll picks it up.
  waitUntil(growSpace(userId, space).then(() => drainQueue(undefined, deadline)))
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

  if (depth.pending > 0 || depth.running > 0) {
    waitUntil(drainQueue())
    return
  }

  // Nothing queued. This is the moment to check whether anything of theirs
  // is starved — a collection whose last grow failed has no other way back,
  // because the thing that would retry it is finishing a note they do not
  // have. Behind a fifteen-minute per-collection cooldown and the shared
  // daily budget, so a collection that keeps failing cannot turn a
  // five-second poll into a quota fire. See onboarding/ensure.ts.
  waitUntil(ensureStocked(req.user!.id).then((r) => {
    if (r.grown || r.revealed) console.log('[ensure]', JSON.stringify(r))
  }))

  // Notes still unwritten and an empty queue is the stranded case: an
  // invocation died holding work nothing else knew about. Rare, and the only
  // moment a reconcile is worth its scan — running it on every poll would
  // sweep the whole notes table every five seconds to find nothing.
  if (job && job.notesTotal > 0 && job.notesDrafted < job.notesTotal) {
    waitUntil(reconcileQueue().then(() => drainQueue()))
  }
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
