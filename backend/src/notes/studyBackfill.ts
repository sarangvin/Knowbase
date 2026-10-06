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
}

export interface StudyBackfillResult {
  needing: number
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
  const out: StudyBackfillResult = { needing: 0, generated: 0, copied: 0, empty: 0, failed: 0, stoppedBecause: 'done' }
  const all = await topicRows()
  // The shared library first: its notes are the ones other notes copy from.
  const todo = all.filter((r) => needsStudy(r.content)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'global' ? -1 : 1))
  out.needing = todo.length
  if (opts.dryRun) return { ...out, stoppedBecause: 'dry-run' }
  if (todo.length && !process.env.GEMINI_API_KEY) return { ...out, stoppedBecause: 'no-key' }

  const twins = twinIndex(all)
  let calls = 0
  // Once a limit is hit no more model calls are made, but the pass carries
  // on to the end: a copy from an identical note costs nothing and there is
  // no reason to leave those undone.
  let halted = false
  for (const row of todo) {
    const context = contextOfNote(row.content)
    const twin = (twins.get(row.path) ?? []).find((t) => t.context === context)
    if (twin) {
      if (await writeInto(row, twin.data)) out.copied++
      continue
    }
    if (halted) continue
    if (calls >= opts.limit) {
      out.stoppedBecause = 'limit'
      halted = true
      continue
    }
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) {
      out.stoppedBecause = 'time'
      halted = true
      continue
    }
    if ((await callsSinceQuotaReset()) >= opts.dailyCallBudget) {
      out.stoppedBecause = 'quota'
      halted = true
      continue
    }
    if (opts.pauseMs && calls > 0) await new Promise((r) => setTimeout(r, opts.pauseMs))
    calls++
    try {
      const data = await generateStudy(titleOf(row.path), row.content, row.owner ?? undefined)
      if (await writeInto(row, data)) {
        out.generated++
        if (data.terms.length === 0 && data.quiz.length === 0) out.empty++
        // Later notes with the same text copy this one.
        const list = twins.get(row.path) ?? []
        list.push({ context, data })
        twins.set(row.path, list)
      }
    } catch (err) {
      out.failed++
      console.warn(`[study-backfill] ${row.path} failed:`, err)
    }
  }
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
