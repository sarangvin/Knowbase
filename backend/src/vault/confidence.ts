// Moving a note's confidence from something that happened *outside* the note.
//
// Confidence is earned, not typed in. Four things move it, all by one:
//
//   reviewing the note            +1   (client-side — see ReviewBar.tsx)
//   turning over one of its cards +1   (routes/flashcards.ts)
//   answering its quiz question   +1 right, -1 wrong   (routes/quiz.ts)
//
// The last two land here. This lived in quiz/score.ts while the quiz was the
// only thing outside the reader that touched confidence; flashcards made it a
// second caller, and one rule with two homes is how the clamp or the status
// flip ends up applied in one and not the other.
//
// What this deliberately does NOT touch is `last_reviewed`. Answering a
// question or turning a card is not reading the note, and writing the date
// here would silently consume its once-a-day review and move it out of the
// "study next" queue on the strength of one lucky guess.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { SPACE_ROOT } from './spaces.js'
import { frontmatterNumber, frontmatterValue, setFrontmatterValue } from './frontmatter.js'

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
export async function adjustConfidence(
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

    // Keep `status` honest in both directions. A wrong quiz answer can lower
    // confidence, which makes a note stuck on "known" at 1/5 a real
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
    console.warn('[confidence] could not adjust', notePath, err)
    return null
  }
}
