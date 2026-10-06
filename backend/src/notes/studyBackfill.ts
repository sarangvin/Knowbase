// Giving notes their study material after the fact.
//
// New notes get it from the same call that drafts them (onboarding/
// draftNote.ts). Everything written before that has none, and a reader whose
// notes have none cannot deal a flashcard deck or a quiz. This fills them in:
// one model call per note, and none at all when an identical note elsewhere
// already has it — a personal note adopted from the library is a copy of one
// that does.
//
// Two ways in. `backfillStudy` is the bounded, resumable pass for a script
// ("which notes still need this" is a query, not a cursor, so running it
// again picks up where it stopped). `fillStudyInBackground` is the quiet one:
// when someone asks for a deck and their notes have nothing yet, it fills a
// few in behind the request so their next try works.
import { waitUntil } from '@vercel/functions'
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, vaults } from '../db/schema.js'
import { SPACE_ROOT, spaceOf, archivedSpaces } from '../vault/spaces.js'
import { frontmatterValue } from '../vault/frontmatter.js'
import { callsSinceQuotaReset } from '../usage/quotaWindow.js'
import { contextOfNote, generateStudy, needsStudy, storedOf, writeStudy, type StudyData } from './study.js'

export interface StudyBackfillOptions {
  /** Most notes to give model calls to in one pass. Copies are free and do
   *  not count. */
  limit: number
  /** Stop once this many model calls have been made since the quota reset,
   *  so a backfill cannot eat the ceiling that real usage shares. */
  dailyCallBudget: number
  /** Gap between model calls, to stay under the per-minute limit. */
  pauseMs?: number
  /** Wall-clock stop. */
  budgetMs?: number
  /** Report what is left without doing any of it. */
  dryRun?: boolean
  /** Confine model calls to these (see MeteredCallOptions.models). The daily
   *  budget then counts only their calls, since quotas are per model. */
  models?: string[]
  /** Deadline per call; slow models need more than the default. */
  timeoutMs?: number
  /** Model calls in flight at once. With several `models`, the workers are
   *  spread across them — each starts on a different one — so every model's
   *  quota is used rather than all of it landing on the first. */
  concurrency?: number
  /** Most calls started per model per minute (AI Studio counts requests per
   *  model per minute). Unset: no limit. */
  perModelRpm?: number
}

/** Start times per model over the last minute, shared by the workers. */
function rateLimiter(rpm: number | undefined) {
  const starts = new Map<string, number[]>()
  return async (model: string) => {
    if (!rpm) return
    for (;;) {
      const now = Date.now()
      const recent = (starts.get(model) ?? []).filter((t) => now - t < 60_000)
      if (recent.length < rpm) {
        recent.push(now)
        starts.set(model, recent)
        return
      }
      await new Promise((r) => setTimeout(r, 60_000 - (now - recent[0]) + 50))
    }
  }
}

export interface StudyBackfillResult {
  needing: number
  /** Distinct notes among those, after identical copies are grouped: the
   *  model calls a full pass would make. */
  unique: number
  generated: number
  copied: number
  empty: number
  failed: number
  stoppedBecause: 'done' | 'limit' | 'quota' | 'time' | 'no-key' | 'dry-run'
}

interface Row {
  id: string
  path: string
  content: string
  vaultId: string
  kind: string
  owner: string | null
}

async function topicRows(): Promise<Row[]> {
  return db
    .select({
      id: notes.id,
      path: notes.path,
      content: notes.content,
      vaultId: notes.vaultId,
      kind: vaults.kind,
      owner: vaults.ownerUserId,
    })
    .from(notes)
    .innerJoin(vaults, eq(vaults.id, notes.vaultId))
    .where(like(notes.path, `${SPACE_ROOT}%/Topics/%`))
}

const titleOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

/** Write study data into a note, re-reading first: a reader or a draft may
 *  have touched it since it was selected, and a write over their edit is
 *  worse than a write not made. */
async function writeInto(row: Row, data: StudyData): Promise<boolean> {
  const [fresh] = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, row.vaultId), eq(notes.path, row.path)))
    .limit(1)
  if (!fresh || !needsStudy(fresh.content)) return false
  const content = writeStudy(fresh.content, data)
  await db
    .update(notes)
    .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
    .where(and(eq(notes.vaultId, row.vaultId), eq(notes.path, row.path)))
  return true
}

/** The same note elsewhere that already has study data, keyed by path and
 *  checked by its text — a copy only when what the data was written from is
 *  what this note says. */
function twinIndex(all: Row[]): Map<string, { context: string; data: StudyData }[]> {
  const byPath = new Map<string, { context: string; data: StudyData }[]>()
  for (const r of all) {
    const data = storedOf(r.content)
    if (!data) continue
    const list = byPath.get(r.path) ?? []
    list.push({ context: contextOfNote(r.content), data })
    byPath.set(r.path, list)
  }
  return byPath
}

export async function backfillStudy(opts: StudyBackfillOptions): Promise<StudyBackfillResult> {
  const started = Date.now()
  const out: StudyBackfillResult = { needing: 0, unique: 0, generated: 0, copied: 0, empty: 0, failed: 0, stoppedBecause: 'done' }
  const all = await topicRows()
  const todo = all.filter((r) => needsStudy(r.content))
  out.needing = todo.length

  // Notes with an identical twin that already has data are copies. The rest
  // are grouped by path and text, so each distinct note is asked about once
  // and its answer written into every copy — the shared library's copy
  // first, as the one that is generated, since it is what others copy from.
  const twins = twinIndex(all)
  const copies: { row: Row; data: StudyData }[] = []
  const groups = new Map<string, Row[]>()
  for (const row of todo) {
    const context = contextOfNote(row.content)
    const twin = (twins.get(row.path) ?? []).find((t) => t.context === context)
    if (twin) {
      copies.push({ row, data: twin.data })
      continue
    }
    const key = `${row.path}\u0000${context}`
    const g = groups.get(key) ?? []
    g.push(row)
    groups.set(key, g)
  }
  for (const g of groups.values()) g.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'global' ? -1 : 1))
  out.unique = groups.size
  if (opts.dryRun) return { ...out, stoppedBecause: 'dry-run' }

  for (const { row, data } of copies) if (await writeInto(row, data)) out.copied++

  if (groups.size && !process.env.GEMINI_API_KEY) return { ...out, stoppedBecause: 'no-key' }

  const queue = [...groups.values()]
  let calls = 0
  let halted = false
  const halt = (why: StudyBackfillResult['stoppedBecause']) => {
    if (!halted) out.stoppedBecause = why
    halted = true
  }

  const limit = rateLimiter(opts.perModelRpm)
  const worker = async (n: number) => {
    // This worker's model order: rotated so worker n starts on model n.
    const models = opts.models?.length
      ? [...opts.models.slice(n % opts.models.length), ...opts.models.slice(0, n % opts.models.length)]
      : undefined
    for (;;) {
      if (halted) return
      const group = queue.shift()
      if (!group) return
      if (calls >= opts.limit) return halt('limit')
      if (opts.budgetMs && Date.now() - started > opts.budgetMs) return halt('time')
      if ((await callsSinceQuotaReset(opts.models)) >= opts.dailyCallBudget) return halt('quota')
      calls++
      if (models) await limit(models[0])
      const [first, ...rest] = group
      try {
        const data = await generateStudy(titleOf(first.path), first.content, first.owner ?? undefined, 'study-backfill', {
          models,
          timeoutMs: opts.timeoutMs,
        })
        if (await writeInto(first, data)) {
          out.generated++
          if (data.terms.length === 0 && data.quiz.length === 0) out.empty++
        }
        for (const r of rest) if (await writeInto(r, data)) out.copied++
        const done = out.generated + out.failed
        if (done % 10 === 0) console.log(`[study-backfill] ${done}/${groups.size} generated, ${out.copied} copied, ${out.failed} failed`)
      } catch (err) {
        out.failed++
        console.warn(`[study-backfill] ${first.path} failed:`, err instanceof Error ? err.message : err)
      }
      if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, (_, n) => worker(n)))
  return out
}

const inFlight = new Set<string>()

/**
 * Called when a reader asked for a deck or a quiz and found nothing: if they
 * have reviewed notes that simply lack study material, start filling them in
 * and say so. Returns false when there is nothing to fill — then the honest
 * message is "review a note first", not "wait".
 */
export async function fillStudyInBackground(vaultId: string): Promise<boolean> {
  const everything = await topicRows()
  const rows = everything.filter((r) => r.vaultId === vaultId)
  const archived = await archivedSpaces(vaultId)
  const mine = rows.filter((r) => {
    const space = spaceOf(r.path)
    return (
      !(space && archived.has(space)) &&
      !!frontmatterValue(r.content, 'last_reviewed') &&
      needsStudy(r.content)
    )
  })
  if (mine.length === 0) return false
  if (inFlight.has(vaultId)) return true
  inFlight.add(vaultId)
  const twins = twinIndex(everything)
  waitUntil(
    (async () => {
      try {
        let calls = 0
        const started = Date.now()
        for (const row of mine) {
          if (Date.now() - started > 90_000) break
          const context = contextOfNote(row.content)
          const twin = (twins.get(row.path) ?? []).find((t) => t.context === context)
          if (twin) {
            await writeInto(row, twin.data)
            continue
          }
          if (calls >= 6) continue
          calls++
          try {
            await writeInto(row, await generateStudy(titleOf(row.path), row.content, row.owner ?? undefined))
          } catch (err) {
            console.warn(`[study-backfill] ${row.path} failed:`, err)
          }
        }
      } finally {
        inFlight.delete(vaultId)
      }
    })(),
  )
  return true
}
