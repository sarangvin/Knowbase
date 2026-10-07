// Write library collections for the example topics nobody has asked for yet.
//
// The "Start a brand new collection" box suggests topics from a fixed list
// (src/features/onboarding/examples.ts). A suggestion the library already
// holds is copied in seconds and costs nothing; one it does not is planned
// and drafted from scratch while the reader waits. This fills the library
// for the rest, so that every topic the app suggests is instant.
//
// Each collection is built the way onboarding builds one — the same plan
// call, the same drafter (which also writes the note's flashcard terms and
// quiz options), the same Next Up note — but straight into the shared
// library, with no reader's vault in between. About six model calls per
// collection: one plan, one per note.
//
//   cd backend
//   npx tsx --env-file=.env src/onboarding/seedLibrary.ts --dry
//   npx tsx --env-file=.env src/onboarding/seedLibrary.ts --limit 10
//
// Paced to at most 12 calls a minute, under Flash-Lite's 15. Calls are
// metered to the owner (OWNER_EMAILS), so they show in admin and
// count against the daily budget check; the run stops when calls since the
// quota reset pass --budget (default 650 of the ~1,000 Flash-Lite requests a
// day), leaving the rest for readers. Safe to rerun: a topic the library
// has, under its typed name or the name the plan gives it, is skipped.
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { primaryModel } from '../llm/models.js'
import { generateLearningPlan } from './plan.js'
import { draftOne } from './draftNote.js'
import { buildTopicNote, buildNextUpNote, dedupeSegments } from './notePlan.js'
import { SPACE_ROOT, contributeToLibrary, findLibrarySpaceFor, normalizeTopic } from '../vault/spaces.js'
import { callsSinceQuotaReset } from '../usage/quotaWindow.js'
import { readFileSync } from 'node:fs'

// The list the box suggests from, read out of the frontend's own file so
// there is one list. Read rather than imported: the backend build only
// compiles backend/src.
const TOPICS = [
  ...readFileSync(new URL('../../../src/features/onboarding/examples.ts', import.meta.url), 'utf8')
    .match(/export const TOPICS = \[([\s\S]*?)\]/)![1]
    .matchAll(/'([^']+)'/g),
].map((m) => m[1])

const args = process.argv.slice(2)
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback
}
const dry = args.includes('--dry')

/** Flash-Lite allows 15 requests a minute per model. Seeding stays at 12 or
 *  fewer — one call at least every 5 seconds — so readers' own requests
 *  still have room under the limit while it runs. */
const MIN_GAP_MS = 5_000
let lastCall = 0
async function pace(): Promise<void> {
  const wait = lastCall + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

/** A database call, retried once. Drafting a collection keeps the script
 *  waiting on the model for minutes, long enough for Neon to close the idle
 *  connection; the next query then fails on the dead socket. The pool hands
 *  out a fresh connection on the retry. "Sleep science" failed twice this way
 *  with all five notes drafted. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.warn('[seed] database call failed, retrying once:', err instanceof Error ? err.message : err)
    await new Promise((r) => setTimeout(r, 2_000))
    return fn()
  }
}

/** "Roman history" -> "Roman History", leaving short joining words alone
 *  unless they come first: "The Silk Road", "Philosophy of Mind". */
function titleCase(s: string): string {
  const small = new Set(['of', 'and', 'the', 'in', 'on', 'for', 'to', 'a', 'an'])
  return s
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}
const limit = num('limit', TOPICS.length)
const budget = num('budget', 650)

const missing: string[] = []
for (const topic of TOPICS) if (!(await findLibrarySpaceFor(topic))) missing.push(topic)
console.log(`${TOPICS.length} example topics, ${TOPICS.length - missing.length} already in the library, ${missing.length} to write`)
if (dry) {
  console.log(missing.join(', '))
  process.exit(0)
}

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
const ownerEmail = (process.env.OWNER_EMAILS ?? '').split(',')[0]?.trim()
const [owner] = ownerEmail
  ? await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, ownerEmail.toLowerCase())).limit(1)
  : []
const userId = owner?.id

let written = 0
for (const topic of missing.slice(0, limit)) {
  const used = await withRetry(() => callsSinceQuotaReset())
  if (used >= budget) {
    console.log(`stopping: ${used} model calls since the quota reset (budget ${budget}). Rerun after midnight Pacific.`)
    break
  }
  try {
    await pace()
    const plan = await generateLearningPlan(topic, userId)
    // The plan names the collection, and its name can be one the library has
    // even when the typed topic was not.
    const existing = await withRetry(() => findLibrarySpaceFor(plan.space))
    if (existing) {
      console.log(`${topic}: the plan named it "${plan.space}", already in the library — skipped`)
      continue
    }
    // Filed under the topic as the box suggests it, not the plan's own name
    // for it. The library is found by name, so "Botany" planned as "Plant
    // Biology" was a collection nobody typing "Botany" would ever reach.
    const space = normalizeTopic(plan.space) === normalizeTopic(topic) ? plan.space : titleCase(topic)
    const titles = plan.subtopics.map((s) => s.title)
    const segments = dedupeSegments(titles)
    const entries: { path: string; content: string }[] = []
    for (let i = 0; i < plan.subtopics.length; i++) {
      const s = plan.subtopics[i]
      const path = `${SPACE_ROOT}${space}/Topics/${segments[i]}.md`
      const placeholder = buildTopicNote(s.title, s, null, { pending: true })
      await pace()
      const draft = await draftOne(
        apiKey,
        primaryModel(),
        space,
        { path, title: s.title, summary: s.summary, placeholder },
        titles,
        userId,
        'library-seed',
      )
      // A note whose draft failed is left out rather than written as a stub:
      // the library copies what it holds as finished, and an adopted stub
      // would never be drafted.
      if (draft) entries.push({ path, content: draft })
    }
    if (entries.length < 3) {
      console.log(`${topic}: only ${entries.length} notes drafted — not added (needs 3 to be suggested)`)
      continue
    }
    entries.push({ path: `${SPACE_ROOT}${space}/Next Up.md`, content: buildNextUpNote(space) })
    const added = await withRetry(() => contributeToLibrary(entries))
    written++
    console.log(`${topic} -> "${space}": ${entries.length - 1} of ${plan.subtopics.length} notes, ${added} added to the library`)
  } catch (err) {
    console.log(`${topic}: FAILED ${err instanceof Error ? err.message : err}`)
  }
}
console.log(`\n${written} collections added`)
process.exit(0)
