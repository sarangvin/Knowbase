// Reading and writing single scalars in a note's YAML frontmatter.
//
// This existed three times over before it lived here: once in grow.ts, once
// in quiz/build.ts, and once — the writer — on the client in
// src/vault/parse.ts. The duplicated readers are now imports; the client's
// copy stays where it is, because the two workspaces do not share a build,
// but the semantics below are deliberately identical to it and the two
// should be changed together.
//
// A line edit rather than parse-and-re-dump, for the same reason the client
// does it that way: these files are also an Obsidian vault that people
// hand-edit. Round-tripping through a YAML serializer would reorder keys,
// restyle quoting and drop comments, turning "got a quiz question right"
// into a diff touching every line of the block.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

/** One top-level scalar, or null. Indented lines are skipped: they belong to
 *  a nested structure (a prerequisites list, say), not to the top level. */
export function frontmatterValue(raw: string, key: string): string | null {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) return null
  for (const line of m[1].split('\n')) {
    if (/^\s/.test(line)) continue
    const km = line.match(new RegExp(`^${escapeKey(key)}\\s*:(.*)$`, 'i'))
    if (km) return km[1].trim()
  }
  return null
}

/** A numeric scalar, or `fallback` when absent or unparseable. */
export function frontmatterNumber(raw: string, key: string, fallback = 0): number {
  const v = frontmatterValue(raw, key)
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function escapeKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace a single scalar, touching nothing else in the file.
 *
 * Returns the input unchanged when there is no frontmatter, or no line for
 * that key. Inventing a key the note never declared would be a surprising
 * side effect of answering a quiz question.
 */
export function setFrontmatterValue(raw: string, key: string, value: string | number): string {
  const m = raw.match(FRONTMATTER_RE)
  if (!m || m.index == null) return raw

  const block = m[1]
  const lines = block.split('\n')
  const keyRe = new RegExp(`^(${escapeKey(key)}\\s*:)(\\s*)(.*)$`, 'i')

  let found = false
  const next = lines.map((line) => {
    if (found || /^\s/.test(line)) return line
    const km = line.match(keyRe)
    if (!km) return line
    found = true
    // Keep the author's spacing after the colon; default to one space for a
    // key written bare ("confidence:").
    return `${km[1]}${km[2] || ' '}${value}`
  })
  if (!found) return raw

  return raw.slice(0, m.index) + m[0].replace(block, next.join('\n')) + raw.slice(m.index + m[0].length)
}
