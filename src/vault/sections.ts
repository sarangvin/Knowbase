// Finding and replacing a `## Name` section of a note's markdown.
//
// These outlived AI Sync (removed), which they were written for: the reader
// uses them for My Notes.

export interface Section {
  contentStart: number
  contentEnd: number
  text: string
}

/** Locate a `## Name` section's content span within raw markdown. */
export function extractSection(raw: string, name: string): Section | null {
  const re = new RegExp(`(^|\\n)##\\s+${name}[^\\n]*\\n`, 'i')
  const m = raw.match(re)
  if (!m || m.index == null) return null
  const contentStart = m.index + m[0].length
  const rest = raw.slice(contentStart)
  const next = rest.search(/\n##\s+/)
  const contentEnd = next < 0 ? raw.length : contentStart + next
  return { contentStart, contentEnd, text: raw.slice(contentStart, contentEnd) }
}

/** Replace a section's content (or append the section if missing). */
export function replaceSection(raw: string, name: string, newContent: string): string {
  const sec = extractSection(raw, name)
  const body = `\n${newContent.trim()}\n`
  if (sec) return raw.slice(0, sec.contentStart) + body + raw.slice(sec.contentEnd)
  const sep = raw.endsWith('\n') ? '\n' : '\n\n'
  return `${raw}${sep}## ${name}\n${body}`
}
