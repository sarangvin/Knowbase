// ─────────────────────────────────────────────────────────────────────────────
// Builds the cross-vault index: resolves wikilinks, computes backlinks, tags,
// and graph data. Obsidian-style resolution: match by basename (case-insensitive),
// preferring an exact-path match when the link includes folders.
// ─────────────────────────────────────────────────────────────────────────────
import type { GraphData, Note, VaultIndex } from './types'
import { archivedSpaces, spaceOfPath } from './collections'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Resolve a single link target string to a note path, or null. */
export function resolveTarget(
  target: string,
  notes: Map<string, Note>,
  nameToPath: Map<string, string>,
): string | null {
  if (!target) return null
  const t = target.replace(/\.md$/i, '')
  // 1) exact path match (with or without .md), possibly folder-qualified
  if (notes.has(`${t}.md`)) return `${t}.md`
  if (notes.has(t)) return t
  // 2) path ending match: "folder/Name" where stored path ends with it
  const lowerT = norm(t)
  for (const p of notes.keys()) {
    if (norm(p.replace(/\.md$/i, '')).endsWith(lowerT)) {
      // only accept if the segment boundary is clean
      const tail = p.replace(/\.md$/i, '')
      if (norm(tail) === lowerT || norm(tail).endsWith('/' + lowerT)) return p
    }
  }
  // 3) basename match
  const byName = nameToPath.get(norm(t.split('/').pop() ?? t))
  return byName ?? null
}

export function buildIndex(noteList: Note[]): VaultIndex {
  const notes = new Map<string, Note>()
  const nameToPath = new Map<string, string>()
  for (const n of noteList) {
    notes.set(n.path, n)
    nameToPath.set(norm(n.name), n.path)
  }

  const backlinks = new Map<string, Set<string>>()
  const forwardlinks = new Map<string, Set<string>>()
  const tags = new Map<string, Set<string>>()
  const unresolved = new Map<string, Set<string>>()

  for (const note of notes.values()) {
    const fwd = new Set<string>()
    for (const link of note.links) {
      const resolved = resolveTarget(link.target, notes, nameToPath)
      link.resolved = resolved
      if (resolved && resolved !== note.path) {
        fwd.add(resolved)
        if (!backlinks.has(resolved)) backlinks.set(resolved, new Set())
        backlinks.get(resolved)!.add(note.path)
      } else if (!resolved) {
        const key = link.target
        if (!unresolved.has(key)) unresolved.set(key, new Set())
        unresolved.get(key)!.add(note.path)
      }
    }
    forwardlinks.set(note.path, fwd)
    for (const tag of note.tags) {
      if (!tags.has(tag)) tags.set(tag, new Set())
      tags.get(tag)!.add(note.path)
    }
  }

  return { notes, nameToPath, backlinks, forwardlinks, tags, unresolved }
}

/** Backlink note paths for a given note path. */
export function backlinksOf(index: VaultIndex, path: string): string[] {
  return [...(index.backlinks.get(path) ?? [])].sort()
}

/** Build force-graph data. When `focusPath` is set, returns the local neighborhood. */
/** Generated scaffolding: dashboards, settings and boilerplate. None of it
 *  is knowledge, and none of it belongs in a graph of what a vault is
 *  about.
 *
 *  Next Up is the worst of them — one per collection, linked to whatever it
 *  is recommending today, so it is a hub wired to half the vault, drawn
 *  with the same weight as a real idea. _config is a settings file, and
 *  archiving *writes* one for any collection that lacks it, so setting a
 *  subject aside would otherwise add a node. The rest are stray dots. */
const SCAFFOLD_NAMES = /^(Next Up|_config|Today|Quiz|Flashcards|README|Topic Note|Welcome)\.md$/i

function isScaffold(path: string): boolean {
  // Never anything under Topics/. That folder is the vault's actual
  // content, and a topic note is a topic note whatever it is called — a
  // subject with a note named "Welcome" or "Quiz" is not far-fetched, and
  // silently dropping it from the graph would be a worse bug than the one
  // being fixed.
  if (path.includes('/Topics/')) return false
  return SCAFFOLD_NAMES.test(path.split('/').pop() ?? '')
}

export function buildGraphData(index: VaultIndex, focusPath?: string, depth = 1): GraphData {
  // A collection that has been set aside is not part of the picture of what
  // this vault is about. Its notes are all still there — Files still lists
  // them — but the graph answers "how does this subject hang together", and
  // a subject you have shelved is not one of the answers.
  const archived = archivedSpaces(index)
  const hidden = (p: string): boolean => {
    if (isScaffold(p)) return true
    const space = spaceOfPath(p)
    return space != null && archived.has(space)
  }

  const includeAll = !focusPath
  let included: Set<string>
  if (includeAll) {
    included = new Set([...index.notes.keys()].filter((p) => !hidden(p)))
  } else {
    // The focus is always in, even if it is hidden by the rules above:
    // someone looking at a note — in an archived collection, or a dashboard
    // — should see its neighbourhood rather than a blank pane.
    included = new Set([focusPath!])
    let frontier = new Set([focusPath!])
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>()
      for (const p of frontier) {
        for (const f of index.forwardlinks.get(p) ?? []) if (!included.has(f) && !hidden(f)) next.add(f)
        for (const b of index.backlinks.get(p) ?? []) if (!included.has(b) && !hidden(b)) next.add(b)
      }
      next.forEach((p) => included.add(p))
      frontier = next
    }
  }

  const degree = new Map<string, number>()
  const links: GraphData['links'] = []
  for (const p of included) {
    for (const f of index.forwardlinks.get(p) ?? []) {
      if (!included.has(f)) continue
      links.push({ source: p, target: f })
      degree.set(p, (degree.get(p) ?? 0) + 1)
      degree.set(f, (degree.get(f) ?? 0) + 1)
    }
  }

  const nodes: GraphData['nodes'] = [...included].map((p) => {
    const note = index.notes.get(p)
    return {
      id: p,
      label: note?.name ?? p,
      resolved: !!note,
      degree: degree.get(p) ?? 0,
      tags: note?.tags ?? [],
    }
  })

  return { nodes, links }
}
