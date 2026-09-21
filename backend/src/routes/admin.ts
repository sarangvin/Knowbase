// Owner-only visibility into every user's vault and usage, per the product
// requirement that "each user's vault and usage should be trackable" by the
// owner. Raw SQL for the list query — the aggregate joins (note counts,
// storage bytes, this-month LLM call counts) are more readable hand-written
// than fought through the query builder.
import { Router } from 'express'
import { sql, eq, desc } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, usageEvents, subscriptions, onboardingJobs } from '../db/schema.js'
import { waitUntil } from '@vercel/functions'
import { runOnboarding } from '../onboarding/run.js'
import { queueDepth, drainQueue, reconcileQueue } from '../onboarding/queue.js'
import { requireOwner } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'

export const adminRouter = Router()
adminRouter.use(requireOwner)

const MAX_PAGE_SIZE = 100

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  const result = await db.execute(sql`
    SELECT
      u.id, u.email, u.display_name, u.role, u.plan_tier, u.created_at, u.last_login_at,
      COALESCE(nc.note_count, 0)::int AS note_count,
      COALESCE(nc.storage_bytes, 0)::bigint AS storage_bytes,
      COALESCE(lc.llm_calls, 0)::int AS llm_calls_this_month
    FROM users u
    LEFT JOIN vaults v ON v.owner_user_id = u.id AND v.kind = 'personal'
    LEFT JOIN (
      SELECT vault_id, count(*) AS note_count, sum(size_bytes) AS storage_bytes
      FROM notes GROUP BY vault_id
    ) nc ON nc.vault_id = v.id
    LEFT JOIN (
      SELECT user_id, count(*) AS llm_calls
      FROM usage_events
      WHERE event_type = 'llm_call' AND created_at >= date_trunc('month', now())
      GROUP BY user_id
    ) lc ON lc.user_id = u.id
    ORDER BY u.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  const [{ count }] = (await db.execute(sql`SELECT count(*)::int AS count FROM users`)).rows as { count: number }[]

  res.json({ users: result.rows, page, pageSize, total: count })
}))

// Sign-in log: every account that has actually authenticated, with the
// email-verification claim Google made at that account's most recent login.
//
// `last_login_at IS NOT NULL` is the "has logged in" filter. Today it matches
// every row, because the OAuth callback is the only thing that creates users
// and it always stamps the column — but that's an implementation detail of
// one code path, not a schema guarantee, so the query states the requirement
// rather than assuming it.
//
// email_verified is three-valued and is rendered that way: true / false /
// null, where null means no verification claim has been observed for that
// account yet (a row predating the column, not yet re-authenticated). It is
// deliberately not collapsed into a boolean.
adminRouter.get('/signins', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  const result = await db.execute(sql`
    SELECT
      u.id, u.email, u.email_verified, u.display_name, u.role,
      u.access_approved, u.access_approved_at, u.access_requested_at, u.requested_topic,
      u.created_at, u.last_login_at,
      COALESCE(lg.login_count, 0)::int AS login_count
    FROM users u
    LEFT JOIN (
      SELECT user_id, count(*) AS login_count
      FROM usage_events WHERE event_type = 'login' GROUP BY user_id
    ) lg ON lg.user_id = u.id
    WHERE u.last_login_at IS NOT NULL
    ORDER BY u.last_login_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  const [counts] = (await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE email_verified IS TRUE)::int  AS verified,
      count(*) FILTER (WHERE email_verified IS FALSE)::int AS unverified,
      count(*) FILTER (WHERE email_verified IS NULL)::int  AS unknown,
      count(*) FILTER (WHERE access_approved)::int         AS approved,
      count(*) FILTER (
        WHERE NOT access_approved AND access_requested_at IS NOT NULL
      )::int AS pending
    FROM users WHERE last_login_at IS NOT NULL
  `)).rows as {
    total: number; verified: number; unverified: number; unknown: number
    approved: number; pending: number
  }[]

  res.json({ signins: result.rows, page, pageSize, ...counts })
}))

// Grant or revoke early access. Body: { approved: boolean }.
//
// An owner's own row is refused rather than silently ignored: resolveSession
// forces accessApproved true for owners, so a "revoked" owner would still
// have full access and the admin table would show a state that isn't real.
// Vault concepts: what each user actually has in their vault, one row per
// space ("Automated Graph/<Space>/…"). A user with several spaces gets
// several rows; a signed-up user with an empty vault still gets one, because
// "signed up and never generated anything" is the single most useful thing
// this table can tell you.
//
// Two different notions of "first used", deliberately kept apart:
//   • vault_created  — exact. When their personal vault row was created.
//   • first_seen     — approximate. notes has only mtime, no created_at, so
//     this is the oldest surviving note timestamp for that space. Editing
//     every note in a space drags it forward. Labelled as such in the UI
//     rather than presented as a creation date it cannot be.
adminRouter.get('/spaces', asyncHandler(async (_req, res) => {
  const result = await db.execute(sql`
    SELECT
      u.id            AS user_id,
      u.email,
      u.role,
      u.access_approved,
      v.created_at    AS vault_created,
      sp.space,
      COALESCE(sp.n, 0)::int AS note_count,
      sp.first_seen,
      sp.last_updated
    FROM users u
    LEFT JOIN vaults v
      ON v.owner_user_id = u.id AND v.kind = 'personal'
    LEFT JOIN LATERAL (
      SELECT
        split_part(substring(n.path FROM char_length('Automated Graph/') + 1), '/', 1) AS space,
        count(*)                AS n,
        min(n.mtime)            AS first_seen,
        max(n.mtime)            AS last_updated
      FROM notes n
      -- Two slashes after the root: a file sitting directly under
      -- "Automated Graph/" is not a space, matching spaceOf().
      WHERE n.vault_id = v.id AND n.path LIKE 'Automated Graph/%/%'
      GROUP BY 1
    ) sp ON TRUE
    ORDER BY sp.last_updated DESC NULLS LAST, u.email
  `)

  // The corpus is not any one user's, so it is reported separately rather
  // than as a row that would imply somebody owns it.
  const [library] = (await db.execute(sql`
    SELECT
      count(DISTINCT split_part(substring(n.path FROM char_length('Automated Graph/') + 1), '/', 1))::int AS spaces,
      count(*)::int AS notes
    FROM notes n
    JOIN vaults v ON v.id = n.vault_id
    WHERE v.kind = 'global' AND n.path LIKE 'Automated Graph/%/%'
  `)).rows as { spaces: number; notes: number }[]

  // Demo traffic has no vault and no space, so it cannot be a row in the
  // table above — it is reported alongside it instead.
  const [demo] = (await db.execute(sql`
    SELECT
      COALESCE(count(e.id), 0)::int AS visits,
      max(e.created_at)             AS last_visit
    FROM users u
    LEFT JOIN usage_events e ON e.user_id = u.id AND e.event_type LIKE 'demo_%'
    WHERE u.email = 'demo@rabbithole.invalid'
  `)).rows as { visits: number; last_visit: string | null }[]

  res.json({ rows: result.rows, library, demo: demo ?? { visits: 0, last_visit: null } })
}))

// Model usage against the provider's published limits.
//
// Google exposes no API for the figures on its own rate-limit dashboard, so
// this is OUR measured consumption, computed from usage_events — not a read
// of Google's counters. It tracks closely because this key has one caller,
// but it will undercount anything that bypassed the meter and it knows
// nothing about usage from outside this app.
//
// Limits are transcribed from the provider console for the free tier and are
// not discoverable at runtime either; they change when the tier changes, and
// a wrong number here is a wrong number on the dashboard.
const MODEL_LIMITS: Record<string, { rpm: number; tpm: number; rpd: number }> = {
  'gemini-3.5-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
  'gemma-4-26b-a4b-it': { rpm: 30, tpm: 16_000, rpd: 14_400 },
  'gemma-4-31b-it': { rpm: 30, tpm: 16_000, rpd: 14_400 },
}

adminRouter.get('/usage', asyncHandler(async (_req, res) => {
  // Rolling windows, not calendar buckets: "requests in the last minute" is
  // what a per-minute limit actually constrains, and a bucket that resets on
  // the minute would read as zero right after a burst.
  const rows = (await db.execute(sql`
    SELECT
      COALESCE(model, 'unknown') AS model,
      count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int  AS rpm,
      COALESCE(sum(COALESCE(input_tokens,0) + COALESCE(output_tokens,0))
        FILTER (WHERE created_at > now() - interval '1 minute'), 0)::int      AS tpm,
      count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int   AS rpd,
      count(*)::int                                                           AS total,
      max(created_at)                                                         AS last_call
    FROM usage_events
    WHERE event_type = 'llm_call'
    GROUP BY 1
    ORDER BY rpd DESC, total DESC
  `)).rows as { model: string; rpm: number; tpm: number; rpd: number; total: number; last_call: string | null }[]

  // What the calls were for, so a day that burns the quota can be explained
  // rather than just observed.
  const bySource = (await db.execute(sql`
    SELECT COALESCE(metadata->>'source', 'direct') AS source, count(*)::int AS calls
    FROM usage_events
    WHERE event_type = 'llm_call' AND created_at > now() - interval '24 hours'
    GROUP BY 1 ORDER BY calls DESC
  `)).rows as { source: string; calls: number }[]

  res.json({
    models: rows.map((r) => ({ ...r, limits: MODEL_LIMITS[r.model] ?? null })),
    bySource,
    // So the UI never has to guess which row is the one currently in use.
    activeModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    // Outstanding drafting work. A queue you cannot see the depth of is one
    // you find out about when a user reports a note that never filled in.
    queue: await queueDepth(),
  })
}))

/** The draft queue, row by row.
 *
 *  Model usage shows three numbers (waiting / in flight / given up on), which
 *  answers "is anything stuck" and nothing else. When something *is* stuck the
 *  next questions are always whose note it is, how many attempts it has burnt
 *  and what the last error said — and those only exist in the rows.
 *
 *  Done rows are kept to the last 20: the queue's recent history is how you
 *  tell "nothing is running because it is all finished" from "nothing is
 *  running because nothing has run in an hour".
 */
adminRouter.get('/queue', asyncHandler(async (_req, res) => {
  const rows = (await db.execute(sql`
    SELECT q.id, q.status, q.attempts, q.last_error, q.source, q.space, q.title, q.path,
           q.created_at, q.started_at, q.updated_at,
           u.email,
           -- The claim query refuses to start a job while another has been
           -- running for under IN_FLIGHT_SECONDS. Deriving the same predicate
           -- here is what makes "in flight" on the dashboard mean the thing
           -- that is actually blocking the queue, rather than any row left in
           -- 'running' by a killed invocation.
           (q.status = 'running' AND q.started_at > now() - interval '30 seconds') AS in_flight
    FROM draft_queue q
    JOIN users u ON u.id = q.user_id
    WHERE q.status <> 'done'
    ORDER BY
      CASE q.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      q.created_at
  `)).rows

  const recent = (await db.execute(sql`
    SELECT q.id, q.status, q.attempts, q.last_error, q.source, q.space, q.title, q.path,
           q.created_at, q.started_at, q.updated_at, u.email, false AS in_flight
    FROM draft_queue q
    JOIN users u ON u.id = q.user_id
    WHERE q.status = 'done'
    ORDER BY q.updated_at DESC
    LIMIT 20
  `)).rows

  // How long drafts are actually taking, from the meter rather than from the
  // queue — the budget that decides whether a second job fits in one
  // invocation is set against these numbers, so they belong next to them.
  const timing = (await db.execute(sql`
    SELECT count(*)::int AS calls,
           round(avg(latency_ms))::int AS avg_ms,
           max(latency_ms)::int AS max_ms
    FROM usage_events
    WHERE event_type = 'llm_call'
      AND metadata->>'source' = 'queue-draft'
      AND created_at > now() - interval '24 hours'
  `)).rows[0] as { calls: number; avg_ms: number | null; max_ms: number | null }

  res.json({ depth: await queueDepth(), rows, recent, timing })
}))

/** Drain one job now.
 *
 *  Drafting is driven by the status poll, so an empty queue with nobody in the
 *  app stays empty until someone opens it. This is the nudge — the same
 *  drainQueue the poll calls, with no special path of its own to drift. */
adminRouter.post('/queue/drain', asyncHandler(async (_req, res) => {
  const reconciled = await reconcileQueue()
  const drained = await drainQueue()
  res.json({ reconciled, drained, depth: await queueDepth() })
}))

/** Put every given-up-on job back in line, attempts reset to zero.
 *
 *  A 'failed' row is terminal by design — three attempts and the queue stops
 *  spending model calls on it. But the usual reason is a bug or an outage that
 *  has since been fixed, and without this the only way back is SQL. */
adminRouter.post('/queue/retry', asyncHandler(async (_req, res) => {
  const rows = await db.execute(sql`
    UPDATE draft_queue
       SET status = 'pending', attempts = 0, last_error = NULL,
           started_at = NULL, updated_at = now()
     WHERE status = 'failed'
    RETURNING id
  `)
  waitUntil(drainQueue())
  res.json({ requeued: rows.rows.length, depth: await queueDepth() })
}))

adminRouter.post('/users/:id/approve', asyncHandler(async (req, res) => {
  const approved = req.body?.approved
  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'body.approved (boolean) required' })
    return
  }

  const target = await db
    .select({ id: users.id, role: users.role, requestedTopic: users.requestedTopic })
    .from(users)
    .where(eq(users.id, req.params.id))
    .limit(1)
  if (!target[0]) {
    res.status(404).json({ error: 'user not found' })
    return
  }
  if (target[0].role === 'owner') {
    res.status(400).json({ error: 'owners always have access; their approval cannot be changed' })
    return
  }

  const [row] = await db
    .update(users)
    // Clearing the timestamp on revoke keeps "approved_at" meaning "when the
    // access they currently hold was granted", not "when they were last
    // approved at some point in the past".
    .set({ accessApproved: approved, accessApprovedAt: approved ? new Date() : null })
    .where(eq(users.id, req.params.id))
    .returning({ accessApproved: users.accessApproved, accessApprovedAt: users.accessApprovedAt })

  // Being let in is the moment their space can finally be built, and they
  // already told us what they wanted before they knew they had to wait. Not
  // starting here would mean their next visit is the same empty box asking
  // the same question for a third time.
  //
  // Guarded on there being no job yet, so re-approving someone never
  // regenerates a space they have already been using.
  let started: string | null = null
  if (approved && target[0].requestedTopic) {
    const existing = await db
      .select({ status: onboardingJobs.status })
      .from(onboardingJobs)
      .where(eq(onboardingJobs.userId, target[0].id))
      .limit(1)
    if (!existing[0]) {
      started = target[0].requestedTopic
      waitUntil(runOnboarding(target[0].id, started))
    }
  }

  // snake_case to match GET /signins, which is raw SQL and therefore returns
  // column names. Two casings for the same two fields across one resource is
  // exactly the kind of mismatch that reads fine in curl and silently yields
  // `undefined` in the client.
  res.json({ access_approved: row.accessApproved, access_approved_at: row.accessApprovedAt, started })
}))

adminRouter.get('/users/:id', asyncHandler(async (req, res) => {
  const userRows = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1)
  if (!userRows[0]) {
    res.status(404).json({ error: 'user not found' })
    return
  }
  const subRows = await db
    .select({ status: subscriptions.status, planTier: subscriptions.planTier, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, req.params.id))
    .limit(1)
  const recentEvents = await db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.userId, req.params.id))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50)

  const { id, email, displayName, avatarUrl, role, planTier, createdAt, lastLoginAt } = userRows[0]
  res.json({
    user: { id, email, displayName, avatarUrl, role, planTier, createdAt, lastLoginAt },
    subscription: subRows[0] ?? null,
    recentEvents,
  })
}))
