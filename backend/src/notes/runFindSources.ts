// Find sources for every note in one person's collection, as the button
// does for one note (routes/notes.ts POST /sources).
//
//   cd backend
//   npx tsx --env-file=.env src/notes/runFindSources.ts --email you@x.com --space "Advertising Technology" --dry
//   npx tsx --env-file=.env src/notes/runFindSources.ts --email you@x.com --space "Advertising Technology"
//
// One model call per note. --dry finds and prints without writing.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, users, vaults } from '../db/schema.js'
import { findSources, writeSources } from './sources.js'
import { loadOwnNote, writeOwnNote } from './questions.js'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const email = arg('email')
const space = arg('space')
const dry = args.includes('--dry')
if (!email || !space) {
  console.error('--email and --space are required')
  process.exit(1)
}

const rows = await db
  .select({ path: notes.path, vaultId: notes.vaultId })
  .from(notes)
  .innerJoin(vaults, eq(vaults.id, notes.vaultId))
  .innerJoin(users, eq(users.id, vaults.ownerUserId))
  .where(and(eq(users.email, email), eq(vaults.kind, 'personal'), like(notes.path, `Automated Graph/${space}/Topics/%`)))
const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)

const day = new Date().toISOString().slice(0, 10)
let written = 0
let links = 0
for (const row of rows.sort((a, b) => a.path.localeCompare(b.path))) {
  const note = await loadOwnNote(row.vaultId, row.path)
  if (!note) continue
  const title = (row.path.split('/').pop() ?? row.path).replace(/\.md$/i, '')
  try {
    const r = await findSources(title, note.content, { space, userId: owner?.id })
    console.log(`\n${title}: ${r.sources.length} sources (${r.pagesRead} pages read, ${r.claims.length} claims)`)
    for (const s of r.sources) console.log(`  - [${s.strength}] ${s.title}\n      ${s.url}`)
    if (!dry && r.sources.length) {
      const fresh = await loadOwnNote(row.vaultId, row.path)
      if (fresh) {
        await writeOwnNote(row.vaultId, row.path, writeSources(fresh.content, r.sources, day))
        written++
        links += r.sources.length
      }
    }
  } catch (err) {
    console.log(`\n${title}: FAILED ${err instanceof Error ? err.message : err}`)
  }
}
console.log(`\n${dry ? 'dry run' : `wrote ${links} links into ${written} notes`}`)
process.exit(0)
