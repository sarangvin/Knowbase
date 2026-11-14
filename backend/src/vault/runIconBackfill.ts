// Pick a logo for every collection that has none yet (vault/topicIcons.ts).
//
//   cd backend
//   npx tsx --env-file=.env src/vault/runIconBackfill.ts --dry
//   npx tsx --env-file=.env src/vault/runIconBackfill.ts            (Ollama on this machine)
//
// New collections get their icon from the planner; this is for the ones made
// before that. Uses a local Gemma through Ollama (OLLAMA_MODEL, default
// gemma4:latest), 30 collection names per call. Safe to rerun.
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { normalizeTopic } from './spaces.js'
import { ICON_NAMES, validIcon, saveIcon } from './topicIcons.js'

const dry = process.argv.includes('--dry')
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:latest'
const BATCH = 30

const names = (
  (await db.execute(sql`
    SELECT DISTINCT split_part(path, '/', 2) AS space FROM notes
    WHERE path LIKE 'Automated Graph/%/%' AND split_part(path, '/', 2) NOT LIKE '%.md'
  `)).rows as { space: string }[]
).map((r) => r.space)
const have = new Set(((await db.execute(sql`SELECT key FROM collection_icons`)).rows as { key: string }[]).map((r) => r.key))
const byKey = new Map<string, string>()
for (const n of names) if (!have.has(normalizeTopic(n)) && !byKey.has(normalizeTopic(n))) byKey.set(normalizeTopic(n), n)
const todo = [...byKey.values()]
console.log(`${names.length} collections, ${todo.length} without an icon`)
if (dry) process.exit(0)

const SYSTEM = `Pick a logo icon for each topic in a learning app. Choose the ONE icon from this list that best pictures the topic:
${ICON_NAMES.join(', ')}
Answer with JSON only: an object mapping each topic exactly as given to an icon name from the list.`

let saved = 0
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH)
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      format: 'json',
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: batch.join('\n') },
      ],
    }),
  })
  if (!res.ok) {
    console.log(`batch failed: ${res.status}`)
    continue
  }
  const answer = JSON.parse(((await res.json()) as { message: { content: string } }).message.content) as Record<string, unknown>
  for (const name of batch) {
    const icon = validIcon(answer[name])
    if (icon) {
      await saveIcon(name, icon)
      saved++
    }
  }
  console.log(`${saved} icons saved`)
}
process.exit(0)
