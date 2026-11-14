// A topic note's brief: one line on what the reader will learn from it,
// shown wherever the app points at a note before it is opened (Continue on
// the home screen, Next Up's path, the signed-out preview, "Tomorrow" on the
// streak card). Stored in frontmatter as `brief:`.
//
// New notes get it free: it is the planner's own one-line summary of the
// subtopic (onboarding/notePlan.ts). Notes written before it existed get one
// from runBriefBackfill.ts, which asks Gemma in batches.
import { FRONTMATTER_RE } from '../vault/frontmatter.js'

/** YAML-safe: a JSON string is a valid YAML double-quoted scalar. */
export function briefLine(brief: string): string {
  return `brief: ${JSON.stringify(brief.replace(/\s+/g, ' ').trim())}`
}

export function hasBrief(raw: string): boolean {
  const m = raw.match(FRONTMATTER_RE)
  return !!m && /^brief:[ \t]*\S/m.test(m[1])
}

/** Set the note's brief, adding the line at the end of the frontmatter if
 *  the note has none. Unchanged when the note has no frontmatter. */
export function setBrief(raw: string, brief: string): string {
  const m = raw.match(FRONTMATTER_RE)
  if (!m || m.index == null) return raw
  const block = m[1]
  const line = briefLine(brief)
  const next = /^brief:.*$/m.test(block) ? block.replace(/^brief:.*$/m, line) : `${block.replace(/\n*$/, '')}\n${line}`
  return raw.slice(0, m.index) + m[0].replace(block, next) + raw.slice(m.index + m[0].length)
}
