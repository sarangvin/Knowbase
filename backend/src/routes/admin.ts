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
