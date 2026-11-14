// Give every topic note written before briefs existed a `brief:` line.
//
//   cd backend
//   npx tsx --env-file=.env src/notes/runBriefBackfill.ts --dry
//   npx tsx --env-file=.env src/notes/runBriefBackfill.ts
//   npx tsx --env-file=.env src/notes/runBriefBackfill.ts --local   (Ollama on this machine)
//
// --local uses a Gemma model served by Ollama (OLLAMA_MODEL, default
// gemma4:latest, at OLLAMA_URL, default http://localhost:11434): no API quota
// at all, at the speed of the machine it runs on.
//
// Runs locally (or on the Actions runner) straight against the database, not
// through a Vercel function: it is bulk work (see the CPU budget note).
//
// Gemma only, so it spends Gemma's own quota and none of the Flash-Lite
// requests that onboarding and Ask AI share. Notes are sent BATCH at a time,
// and identical notes (a library note and every reader's copy of it) are
// asked about once: the key is the title plus the start of the prose.
//
// Safe to rerun: notes that already have a brief are skipped.
import { createHash } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { SPACE_ROOT } from '../vault/spaces.js'
import { meteredGeminiCall } from '../llm/meter.js'
import { hasBrief, setBrief } from './brief.js'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback
}
const BATCH = num('batch', 12)
const CONCURRENCY = num('concurrency', args.includes('--local') ? 1 : 6)
const LIMIT = num('limit', 100_000)
const GEMMA = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it']
const local = args.includes('--local')
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:latest'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey && !dry && !local) throw new Error('GEMINI_API_KEY is not set')

async function ask(system: string, user: string): Promise<string> {
  if (!local) return meteredGeminiCall(apiKey!, system, user, { source: 'brief-backfill', models: GEMMA, timeoutMs: 300_000 })
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      options: { temperature: 0.3 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { message: { content: string } }).message.content
}

function prose(content: string): string {
  const ai = /##\s+(?:AI Notes|Description)[^\n]*\n([\s\S]*?)(?:\n##\s|$)/i.exec(content)?.[1] ?? content
  return ai.replace(/\*\*Key points\*\*[\s\S]*/i, '').replace(/\s+/g, ' ').trim().slice(0, 700)
}
function titleOf(content: string, path: string): string {
  return /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? path.split('/').pop()!.replace(/\.md$/, '')
}

const rows = await db
  .select({ id: notes.id, path: notes.path, content: notes.content })
  .from(notes)
  .where(like(notes.path, `${SPACE_ROOT}%/Topics/%`))
const todo = rows.filter((r) => !hasBrief(r.content) && /^---/.test(r.content))

// Group identical notes so each is asked about once.
const groups = new Map<string, { title: string; text: string; ids: string[] }>()
for (const r of todo) {
  const title = titleOf(r.content, r.path)
  const text = prose(r.content)
  if (!text) continue
  const key = createHash('sha1').update(`${title}\n${text}`).digest('hex')
  const g = groups.get(key) ?? { title, text, ids: [] }
  g.ids.push(r.id)
  groups.set(key, g)
}
const work = [...groups.values()].slice(0, LIMIT)
console.log(`${rows.length} topic notes, ${todo.length} without a brief, ${groups.size} distinct; this run: ${work.length} in ${Math.ceil(work.length / BATCH)} calls`)
if (dry) process.exit(0)

const SYSTEM = `You write one-line previews of short study notes for a learning app.
For each note, write a brief that tells the reader what they will learn from it.
Rules: one sentence, 8-16 words, plain words, no title repetition, no "this note", no "you will learn", no emojis, no trailing period.
Start with what it covers, e.g. "How hot air rising from the equator drives the trade winds".
Answer with JSON only: an array of {"i": <number>, "brief": "<text>"} in the same order.`

let done = 0
let failed = 0
const batches: (typeof work)[] = []
for (let i = 0; i < work.length; i += BATCH) batches.push(work.slice(i, i + BATCH))

async function runBatch(batch: typeof work): Promise<void> {
  const user = batch.map((g, i) => `${i}. ${g.title}\n${g.text}`).join('\n\n')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await ask(SYSTEM, user)
      const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
      const answers = JSON.parse(json) as { i: number; brief: string }[]
      for (const a of answers) {
        const g = batch[a.i]
        const brief = typeof a.brief === 'string' ? a.brief.replace(/\.$/, '').trim() : ''
        if (!g || brief.length < 8 || brief.length > 160) continue
        for (const id of g.ids) {
          const [row] = await db.select({ content: notes.content }).from(notes).where(eq(notes.id, id))
          if (!row || hasBrief(row.content)) continue
          await db.update(notes).set({ content: setBrief(row.content, brief) }).where(eq(notes.id, id))
        }
        done++
      }
      return
    } catch (err) {
      if (attempt === 1) {
        failed += batch.length
        console.log(`batch failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
}

let next = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < batches.length) {
      const b = batches[next++]
      await runBatch(b)
      console.log(`${done} briefs written, ${failed} failed, ${batches.length - next} batches left`)
    }
  }),
)
console.log(`\nDone: ${done} distinct notes got a brief, ${failed} failed`)
process.exit(0)
