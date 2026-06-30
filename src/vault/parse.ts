// ─────────────────────────────────────────────────────────────────────────────
// Pure parsing helpers: raw markdown text -> structured Note fields.
// No DOM, no store deps — safe to unit test and reuse anywhere.
// ─────────────────────────────────────────────────────────────────────────────
import { load as yamlLoad } from 'js-yaml'
import type { Heading, LinkRef, Note } from './types'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) return { frontmatter: {}, body: raw }
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = yamlLoad(m[1])
    if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>
  } catch {
    /* malformed YAML -> treat as no frontmatter */
  }
  return { frontmatter, body: raw.slice(m[0].length) }
}

export function basename(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/i, '')
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

const WIKILINK_RE = /(!?)\[\[([^\]]+?)\]\]/g

/** Parse a single wikilink inner string "Target#Heading|Alias". */
export function parseLinkInner(inner: string, embed: boolean): Omit<LinkRef, 'resolved' | 'raw'> {
  let rest = inner
  let alias: string | undefined
  const pipe = rest.indexOf('|')
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim()
    rest = rest.slice(0, pipe)
  }
  let heading: string | undefined
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim()
    rest = rest.slice(0, hash)
  }
  return { target: rest.trim(), alias, heading, embed }
}

/** Extract all [[wikilinks]] and ![[embeds]] (resolved=null; resolve later). */
export function extractLinks(text: string): LinkRef[] {
  const out: LinkRef[] = []
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const embed = m[1] === '!'
    out.push({ raw: m[2], ...parseLinkInner(m[2], embed), resolved: null })
  }
  return out
}

const INLINE_TAG_RE = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g
// Strip fenced code so we don't pick up `#comments` or `[[x]]` inside code blocks.
const FENCE_RE = /```[\s\S]*?```|`[^`]*`/g

export function extractTags(frontmatter: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>()
  const fmTags = frontmatter.tags
  if (typeof fmTags === 'string') fmTags.split(/[,\s]+/).forEach((t) => t && tags.add(t.replace(/^#/, '')))
  else if (Array.isArray(fmTags)) fmTags.forEach((t) => typeof t === 'string' && tags.add(t.replace(/^#/, '')))
  const stripped = body.replace(FENCE_RE, '')
  let m: RegExpExecArray | null
  INLINE_TAG_RE.lastIndex = 0
  while ((m = INLINE_TAG_RE.exec(stripped)) !== null) {
    if (!/^\d+$/.test(m[1])) tags.add(m[1])
  }
  return [...tags]
}

export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = []
  const stripped = body.replace(/```[\s\S]*?```/g, '')
  const seen = new Map<string, number>()
  for (const line of stripped.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (!m) continue
    const text = m[2].trim()
    let slug = slugify(text)
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    if (n > 0) slug = `${slug}-${n}`
    out.push({ level: m[1].length, text, slug })
  }
  return out
}

function deriveTitle(frontmatter: Record<string, unknown>, body: string, name: string): string {
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) return frontmatter.title.trim()
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return name
}

/** Full parse of one note's raw text into a Note (links unresolved). */
export function parseNote(path: string, raw: string, mtime: number): Note {
  const { frontmatter, body } = splitFrontmatter(raw)
  const name = basename(path)
  // Links can appear in frontmatter values too (e.g. prerequisites: ["[[X]]"]).
  const fmText = JSON.stringify(frontmatter)
  const links = [...extractLinks(body), ...extractLinks(fmText)]
  return {
    path,
    name,
    title: deriveTitle(frontmatter, body, name),
    frontmatter,
    body,
    raw,
    links,
    tags: extractTags(frontmatter, body),
    headings: extractHeadings(body),
    mtime,
  }
}
