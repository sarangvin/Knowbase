// Pure helpers to fold a Q&A into a note's raw markdown, mirroring the vault's
// `## Questions` convention, and to bump `last_reviewed` in the frontmatter.

function todayISO(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Append a Q/A block under the note's `## Questions` heading (creating it if absent). */
export function insertQA(raw: string, question: string, answer: string): string {
  const block = `Q: ${question.trim()}\n\nA: ${answer.trim()}\n`
  const re = /(^|\n)(##\s+Questions\s*\n)/i
  const m = raw.match(re)
  if (m && m.index != null) {
    // Insert right after the heading line, before any existing Q&As.
    const insertAt = m.index + m[0].length
    const before = raw.slice(0, insertAt)
    const after = raw.slice(insertAt)
    return `${before}\n${block}\n${after.replace(/^\n+/, '')}`
  }
  // No Questions section — append one at the end.
  const sep = raw.endsWith('\n') ? '\n' : '\n\n'
  return `${raw}${sep}## Questions\n\n${block}`
}

/** Set/replace `last_reviewed:` in YAML frontmatter to today. No-op if no frontmatter. */
export function bumpLastReviewed(raw: string): string {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) return raw
  const today = todayISO()
  const body = fm[1]
  let newBody: string
  if (/^\s*last_reviewed\s*:.*$/m.test(body)) {
    newBody = body.replace(/^(\s*last_reviewed\s*:).*$/m, `$1 ${today}`)
  } else {
    newBody = `${body}\nlast_reviewed: ${today}`
  }
  return raw.replace(fm[1], newBody)
}
