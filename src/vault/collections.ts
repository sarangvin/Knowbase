// What a "collection" is, at the level the vault itself understands it.
//
// These two questions — which collection does this path belong to, and has
// that collection been set aside — are asked by the graph builder, the
// store, the reader and the home screen. They lived in
// features/automated-graph/engine.ts, which is the right home for the
// ranking but the wrong one for this: engine.ts imports vault/graph.ts, so
// the graph builder could not import back without a cycle.
//
// Down here, with a dependency on the types and nothing else, everyone can
// reach them and nobody needs a second copy.
import type { VaultIndex } from './types'

export const SPACE_ROOT = 'Automated Graph/'

/** "Automated Graph/<Space>/..." -> "<Space>". */
export function spaceOfPath(path: string): string | null {
  const m = path.match(/^Automated Graph\/([^/]+)\//)
  return m ? m[1] : null
}

/** Archived collections are set aside, not deleted: every note stays where
 *  it was, but the collection drops off the home screen and out of the
 *  graph, quizzes, flashcards and growth. The flag lives in the space's own
 *  `_config.md` so the vault carries it — the server reads the same line. */
export function isArchived(index: VaultIndex, space: string): boolean {
  const v = index.notes.get(`${SPACE_ROOT}${space}/_config.md`)?.frontmatter?.archived
  return v === true || String(v).toLowerCase() === 'true'
}

/** Every archived collection in this vault, by name. */
export function archivedSpaces(index: VaultIndex): Set<string> {
  const out = new Set<string>()
  for (const path of index.notes.keys()) {
    const space = spaceOfPath(path)
    if (space && !out.has(space) && isArchived(index, space)) out.add(space)
  }
  return out
}
