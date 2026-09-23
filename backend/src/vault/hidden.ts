// The buffer of notes that exist but have not been handed over yet.
//
// A collection now keeps two stacks. Three notes the reader can see and has
// not finished, and three more behind them that are fully generated and
// invisible. Finishing a visible note reveals the best of the hidden three
// and starts generation to replace it.
//
// **Why pre-generate at all.** Growth used to start when the shelf ran low,
// so the note you were promised next did not exist yet: a plan call, then a
// draft, tens of seconds each, and in the meantime Next Up showed "Coming
// soon" — a row you cannot click. The buffer moves that latency off the path
// the reader is standing on. The note revealed at the moment they finish one
// is already written.
//
// **Why a frontmatter flag rather than a table.** Everything else about a
// note lives in the note: pending, archived, prerequisites, scores. A second
// place to look for "does this exist for the reader" is a second place to
// get it wrong, and the vault stays a vault — exported to Obsidian, a hidden
// note is a note with `hidden: true` in it, not a dangling reference to a
// row that did not come with it.
//
// **Hidden means the server does not serve it.** The filtering is here and
// in the listing route, not in the client's dashboards. A note the client
// receives and agrees not to draw is one search box, one graph view or one
// quiz builder away from being drawn; and this project has already learned
// once that a hidden control is not a rule.
import { and, eq, like, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { SPACE_ROOT } from './spaces.js'
import { frontmatterValue, frontmatterNumber, setFrontmatterValue } from './frontmatter.js'

/** How many unfinished notes the reader can see in a collection. */
export const VISIBLE_AHEAD = 3

/** How many are kept written and waiting behind those. */
export const HIDDEN_BUFFER = 3

/** Line-anchored, like the `last_reviewed` test in topUp.ts. `(?n)` makes `^`
 *  match at line starts, so this cannot be satisfied by the word appearing in
 *  a note's prose. */
export const NOT_HIDDEN: SQL = sql`${notes.content} !~ '(?n)^hidden: *true'`
export const IS_HIDDEN: SQL = sql`${notes.content} ~ '(?n)^hidden: *true'`

export function isHidden(content: string): boolean {
  return frontmatterValue(content, 'hidden') === 'true'
}

export function isPending(content: string): boolean {
  return frontmatterValue(content, 'pending') === 'true'
}

export function isReviewed(content: string): boolean {
  const v = frontmatterValue(content, 'last_reviewed')
  return !!v && /^\d/.test(v)
}

/** Default weights, matching `DEFAULT_CONFIG` in
 *  `src/features/automated-graph/engine.ts`. The two are deliberately the
 *  same numbers and must be changed together — the workspaces do not share a
 *  build, which is also why `frontmatter.ts` exists twice. */
const DEFAULT_WEIGHTS = { importance: 1, unlocks: 2, interest: 0.5 }

export interface Weights {
  importance: number
  unlocks: number
  interest: number
}

/** The space's ranking weights, from its own `_config.md`. */
export async function weightsOf(vaultId: string, space: string): Promise<Weights> {
  const [row] = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, `${SPACE_ROOT}${space}/_config.md`)))
    .limit(1)
  if (!row) return { ...DEFAULT_WEIGHTS }
  return {
    importance: frontmatterNumber(row.content, 'weight_importance', DEFAULT_WEIGHTS.importance),
    unlocks: frontmatterNumber(row.content, 'weight_unlocks', DEFAULT_WEIGHTS.unlocks),
    interest: frontmatterNumber(row.content, 'weight_interest', DEFAULT_WEIGHTS.interest),
  }
}

/** Titles this note lists as prerequisites, as written: `- "[[Title]]"`. */
export function prereqTitles(content: string): string[] {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return []
  const lines = m[1].split('\n')
  const start = lines.findIndex((l) => /^prerequisites\s*:/i.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+/.test(line)) break // back at the top level: the list is over
    const t = line.match(/\[\[([^\]|#]+)/)
    if (t) out.push(t[1].trim())
  }
  return out
}

export function titleOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

interface TopicRow {
  path: string
  content: string
}

/**
 * Order hidden notes the way Next Up orders visible ones.
 *
 * `score = importance * w + unlocks * w + interest * w`, written notes ahead
 * of unwritten ones. **This mirrors `computeNextUp` in
 * `src/features/automated-graph/engine.ts`** — the same formula, the same
 * tie-break, deliberately. It is the one rule in this file that exists twice,
 * because a reveal that disagreed with the ranking on screen would hand the
 * reader a note the page had just told them was not the best one.
 *
 * Readiness comes first and is not part of the score: a note whose
 * prerequisites are unreviewed lands in "Locked", where the reader cannot
 * open it, so revealing it would spend the buffer on nothing.
 */
export function rankForReveal(hidden: TopicRow[], all: TopicRow[], w: Weights): TopicRow[] {
  const reviewedTitles = new Set(all.filter((r) => isReviewed(r.content)).map((r) => titleOf(r.path)))
  // Unlocks counts unfinished topics that name this one as a prerequisite —
  // including hidden ones, which are the notes most likely to depend on a
  // sibling generated in the same batch.
  const unfinished = all.filter((r) => !isReviewed(r.content))
  const unlocksOf = (title: string) =>
    unfinished.filter((r) => prereqTitles(r.content).includes(title)).length

  return [...hidden]
    .map((r) => {
      const title = titleOf(r.path)
      const ready = prereqTitles(r.content).every((t) => reviewedTitles.has(t))
      return {
        row: r,
        ready,
        pending: isPending(r.content),
        score:
          frontmatterNumber(r.content, 'importance', 3) * w.importance +
          unlocksOf(title) * w.unlocks +
          frontmatterNumber(r.content, 'interest', 3) * w.interest,
      }
    })
    .sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        Number(a.pending) - Number(b.pending) ||
        b.score - a.score,
    )
    .map((x) => x.row)
}

export interface BufferState {
  /** Unfinished notes the reader can see. */
  visible: number
  /** Written and waiting. */
  hidden: number
}

export async function bufferState(vaultId: string, space: string): Promise<BufferState> {
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}${space}/Topics/%`)))
  let visible = 0
  let hidden = 0
  for (const r of rows) {
    if (isHidden(r.content)) hidden++
    else if (!isReviewed(r.content)) visible++
  }
  return { visible, hidden }
}

export interface Revealed {
  path: string
  title: string
}

/**
 * Hand the reader the best of the hidden notes, until the shelf is full.
 *
 * **Usually this reveals exactly one**, because it is called when a note has
 * just been finished and the shelf is one short — which is the beat the
 * whole buffer is for: completing a note visibly produces the next one.
 *
 * It is a "fill the gap" loop rather than a fixed one because the gap is not
 * always one. A collection whose generation failed a few times, or one
 * carried over from before the buffer existed, can sit with an empty shelf
 * and three notes waiting behind it; revealing one per completion would
 * leave a reader with nothing to complete, and nothing would ever reveal
 * again. The shelf being short is the condition, not the review.
 *
 * Never throws: its callers are fire-and-forget.
 */
export async function revealUpTo(vaultId: string, space: string): Promise<Revealed[]> {
  const out: Revealed[] = []
  try {
    const rows = await db
      .select({ path: notes.path, content: notes.content })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}${space}/Topics/%`)))

    const visible = rows.filter((r) => !isHidden(r.content) && !isReviewed(r.content)).length
    const gap = VISIBLE_AHEAD - visible
    if (gap <= 0) return out

    const hidden = rows.filter((r) => isHidden(r.content))
    if (hidden.length === 0) return out

    const ranked = rankForReveal(hidden, rows, await weightsOf(vaultId, space))
    const day = today()

    for (const best of ranked.slice(0, gap)) {
      // `hidden: true` comes out; `revealed:` goes in with the day it
      // happened, which is what the reader's "New" marker is drawn from. A
      // date rather than a boolean so the fact survives being read back and
      // can be reasoned about later.
      let content = best.content.replace(/^hidden:\s*true[ \t]*\r?\n/m, '')
      content = /^revealed\s*:/m.test(content)
        ? setFrontmatterValue(content, 'revealed', day)
        : content.replace(/^---\r?\n/, `---\nrevealed: ${day}\n`)

      // Guarded on the row still being hidden, so two callers racing — a
      // review and the cron landing together — cannot both count it.
      const done = await db
        .update(notes)
        .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
        .where(and(eq(notes.vaultId, vaultId), eq(notes.path, best.path), IS_HIDDEN))
        .returning({ path: notes.path })
      if (done.length > 0) out.push({ path: best.path, title: titleOf(best.path) })
    }
    return out
  } catch (err) {
    console.error('[reveal] failed', err)
    return out
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
