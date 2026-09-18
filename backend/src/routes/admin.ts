// Owner-only visibility into every user's vault and usage, per the product
// requirement that "each user's vault and usage should be trackable" by the
// owner. Raw SQL for the list query — the aggregate joins (note counts,
// storage bytes, this-month LLM call counts) are more readable hand-written
// than fought through the query builder.
import { Router } from 'express'
import { sql, eq, desc } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, usageEvents, subscriptions } from '../db/schema.js'
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
      u.access_approved, u.access_approved_at, u.access_requested_at,
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
adminRouter.post('/users/:id/approve', asyncHandler(async (req, res) => {
  const approved = req.body?.approved
  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'body.approved (boolean) required' })
    return
  }

  const target = await db
    .select({ id: users.id, role: users.role })
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

  // snake_case to match GET /signins, which is raw SQL and therefore returns
  // column names. Two casings for the same two fields across one resource is
  // exactly the kind of mismatch that reads fine in curl and silently yields
  // `undefined` in the client.
  res.json({ access_approved: row.accessApproved, access_approved_at: row.accessApprovedAt })
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
