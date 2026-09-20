// Feeding a quiz answer back into the note it came from.
//
// Getting a question right raises that note's confidence by one; getting it
// wrong lowers it by one. This is what makes the quiz part of the system
// rather than a game attached to the side of it: confidence is what orders
// the review list (lowest first), so a wrong answer floats the note back up
// to be read again, and a right one settles it.
//
// What this deliberately does NOT touch is `last_reviewed`. Answering a
// question about a note is not reading it, and writing the date here would
// silently consume the note's once-a-day review and move it out of the
// "study next" queue on the strength of one lucky guess.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { SPACE_ROOT } from '../vault/spaces.js'
import { frontmatterNumber, frontmatterValue, setFrontmatterValue } from '../vault/frontmatter.js'

export const MIN_CONFIDENCE = 0
export const MAX_CONFIDENCE = 5
const DEFAULT_THRESHOLD = 3

/** The space's learned-at threshold, from its `_config` note. Read rather
 *  than hardcoded so the server and the client's ranking agree on what
 *  "known" means — they have disagreed about a definition before. */
async function thresholdFor(vaultId: string, notePath: string): Promise<number> {
  const space = notePath.startsWith(SPACE_ROOT) ? notePath.slice(SPACE_ROOT.length).split('/')[0] : null
  if (!space) return DEFAULT_THRESHOLD
  const [cfg] = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, `${SPACE_ROOT}${space}/_config.md`)))
    .limit(1)
  if (!cfg) return DEFAULT_THRESHOLD
  return frontmatterNumber(cfg.content, 'confidence_threshold', DEFAULT_THRESHOLD)
}

export interface ConfidenceChange {
  notePath: string
  from: number
  to: number
}

/**
 * Move one note's confidence by `delta`, clamped to 0–5.
 *
 * Returns null when there is nothing to report — the note is gone, has no
 * confidence field, or was already at the end of the scale. "Already at 5
 * and got it right" is not a change, and saying `5 → 5` would read as a
 * system that cannot count.
 *
 * Never throws: the caller has already recorded the answer, and a note write
 * failing must not turn a successful answer into an error.
 */
export async function applyQuizResult(
  vaultId: string,
  notePath: string,
  delta: number,
): Promise<ConfidenceChange | null> {
  try {
    const [row] = await db
      .select({ content: notes.content })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), eq(notes.path, notePath)))
      .limit(1)
    if (!row) return null
    if (frontmatterValue(row.content, 'confidence') == null) return null

    const from = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, Math.round(frontmatterNumber(row.content, 'confidence', 0))))
    const to = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, from + delta))
    if (to === from) return null

    let content = setFrontmatterValue(row.content, 'confidence', to)

    // Keep `status` honest in both directions. Review only ever wrote
    // "known" on the way up, which was fine while nothing went down; a quiz
    // that can lower confidence makes a note stuck on "known" at 1/5 a real
    // possibility, and status is what an exported Obsidian vault sorts by.
    const threshold = await thresholdFor(vaultId, notePath)
    const status = frontmatterValue(content, 'status')
    if (to >= threshold && status === 'frontier') content = setFrontmatterValue(content, 'status', 'known')
    else if (to < threshold && status === 'known') content = setFrontmatterValue(content, 'status', 'frontier')

    if (content === row.content) return null
    await db
      .update(notes)
      .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
      .where(and(eq(notes.vaultId, vaultId), eq(notes.path, notePath)))

    return { notePath, from, to }
  } catch (err) {
    console.warn('[quiz] could not apply the result to', notePath, err)
    return null
  }
}
