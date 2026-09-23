// When the day the provider is counting actually starts.
//
// Gemini's requests-per-day quota **resets at midnight Pacific**. It is a
// fixed window with an edge, not a rolling one.
//
// Everything here used to count `now() - interval '24 hours'`, which is a
// different question with a different answer, and wrong in the direction
// that hurts: a rolling window keeps counting calls the provider has already
// forgiven. Three hours after the reset it still holds twenty-one hours of
// spent quota against a ceiling that is entirely free, so the app refuses to
// generate anything while the provider would happily serve five hundred more
// requests. The worse the previous day, the longer the app stays shut after
// the day that reset it.
//
// One definition, in one file, for the same reason plans.ts and
// frontmatter.ts exist: this was written out three times — in the cron, in
// the ensure loop and in the backfill — and three copies of a window is
// three chances to fix it once.
import { and, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { usageEvents } from '../db/schema.js'

/** The provider's reset zone. Named rather than an offset, so the tz
 *  database handles the two days a year the offset changes; a hardcoded -8
 *  would be an hour wrong for eight months of it. */
export const QUOTA_TZ = 'America/Los_Angeles'

/** Midnight in the provider's zone, most recently passed, as a timestamptz.
 *
 *  `AT TIME ZONE` twice is not a typo: the first converts to wall-clock
 *  time in Los Angeles so the truncation lands on a Pacific midnight, the
 *  second reads that wall-clock value back as an instant. */
export const SINCE_QUOTA_RESET: SQL = sql`(date_trunc('day', now() AT TIME ZONE ${sql.raw(`'${QUOTA_TZ}'`)}) AT TIME ZONE ${sql.raw(`'${QUOTA_TZ}'`)})`

/** Model calls made since the quota last reset — the number the provider is
 *  holding against us right now. */
export async function callsSinceQuotaReset(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.eventType, 'llm_call'), sql`${usageEvents.createdAt} >= ${SINCE_QUOTA_RESET}`))
  return row?.n ?? 0
}

/** Seconds until the next reset. For reporting: "out of budget" is a much
 *  more useful thing to see next to "for another 40 minutes". */
export async function secondsToQuotaReset(): Promise<number> {
  const [row] = await db.execute<{ s: number }>(sql`
    SELECT extract(epoch FROM (
      (date_trunc('day', now() AT TIME ZONE ${sql.raw(`'${QUOTA_TZ}'`)}) + interval '1 day')
        AT TIME ZONE ${sql.raw(`'${QUOTA_TZ}'`)}
    ) - now())::int AS s
  `).then((r) => (r as unknown as { rows: { s: number }[] }).rows)
  return row?.s ?? 0
}
