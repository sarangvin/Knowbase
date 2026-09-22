import { topUpEveryone, findShortCollections } from '/Users/sarang/Codies/knowbase-web/backend/src/onboarding/topUp.js'
import { db } from '/Users/sarang/Codies/knowbase-web/backend/src/db/client.js'
import { usageEvents } from '/Users/sarang/Codies/knowbase-web/backend/src/db/schema.js'
import { and, eq, sql } from 'drizzle-orm'

const calls = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(usageEvents)
  .where(and(eq(usageEvents.eventType, 'llm_call'), sql`${usageEvents.createdAt} > now() - interval '10 minutes'`)))[0].n

console.log('short collections right now:', JSON.stringify(await findShortCollections(20)))
const before = await calls()
const t0 = Date.now()
const res = await topUpEveryone()
console.log(`\nidle pass: ${JSON.stringify(res)} in ${Date.now() - t0}ms`)
console.log('model calls spent by it:', (await calls()) - before, '(should be 0 when nothing is short)')
process.exit(0)
