import { db } from '/Users/sarang/Codies/knowbase-web/backend/src/db/client.js'
import { notes } from '/Users/sarang/Codies/knowbase-web/backend/src/db/schema.js'
import { and, eq, like } from 'drizzle-orm'
import { frontmatterValue } from '/Users/sarang/Codies/knowbase-web/backend/src/vault/frontmatter.js'
import { parseNextTopics } from '/Users/sarang/Codies/knowbase-web/backend/src/onboarding/plan.js'
import { meteredGeminiCall } from '/Users/sarang/Codies/knowbase-web/backend/src/llm/meter.js'

const VAULT = process.env.PROBE_VAULT_ID!
const SPACE = process.env.SPACE ?? 'Marine Biology'
const prefix = `Automated Graph/${SPACE}/Topics/`
const rows = await db.select({ path: notes.path, content: notes.content }).from(notes)
  .where(and(eq(notes.vaultId, VAULT), like(notes.path, prefix + '%')))
const title = (p: string) => (p.split('/').pop() ?? '').replace(/\.md$/, '')
const all = rows.map(r => title(r.path))
const studied = rows.filter(r => !!frontmatterValue(r.content, 'last_reviewed')).map(r => title(r.path))
const want = Math.min(3 - (all.length - studied.length), 3)
console.log(`${SPACE}: ${all.length} topics, ${studied.length} studied, want ${want}`)

// same prompt the grower uses, called directly so we can see the raw reply
const mod = await import('/Users/sarang/Codies/knowbase-web/backend/src/onboarding/plan.js') as any
const t0 = Date.now()
const fresh = await mod.generateNextTopics(SPACE, studied, all, want, '557aff42-4f44-4510-be1b-96ca8f1692f2')
console.log(`generateNextTopics -> ${fresh ? JSON.stringify(fresh.map((f: any) => f.title)) : 'null'}  (${Date.now() - t0}ms)`)
process.exit(0)
