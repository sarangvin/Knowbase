// "Where does this collection start, and where does it go next?" — the
// unfinished, visible topic notes in study order. Used by the onboarding
// emails and by the public library preview, which both need an answer
// without the client's Next Up engine.
//
// The order is a walk: take a topic whose prerequisites are all behind you
// (written notes before stubs still in the queue, then fewest prerequisites,
// then by path), count it as read, repeat. It is an approximation of Next Up,
// which also weighs interest, but it agrees on what is ready.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { SPACE_ROOT } from './spaces.js'

export interface PathTopic {
  path: string
  title: string
  content: string
  /** Titles of the prerequisites, as linked in frontmatter. */
  needs: string[]
  pending: boolean
}

function frontmatter(content: string): string {
  return /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? ''
}

export async function topicPath(vaultId: string, space: string): Promise<PathTopic[]> {
  const prefix = `${SPACE_ROOT}${space}/Topics/`
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${prefix}%`)))
  const topics = rows
    .filter((r) => r.path.startsWith(prefix))
    .map((r) => {
      const fm = frontmatter(r.content)
      const field = (k: string) => new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(fm)?.[1]?.trim() ?? ''
      const needs = (/^prerequisites:[ \t]*\n((?:[ \t]+-.*\n?)*)/m.exec(fm)?.[1] ?? '')
        .split('\n')
        .map((l) => /\[\[([^\]|#]+)/.exec(l)?.[1]?.trim())
        .filter((t): t is string => !!t)
      const title = /^#\s+(.+)$/m.exec(r.content)?.[1]?.trim() ?? r.path.slice(prefix.length).replace(/\.md$/, '')
      return {
        path: r.path,
        title,
        content: r.content,
        needs,
        name: r.path.slice(prefix.length).replace(/\.md$/, ''),
        reviewed: field('last_reviewed') !== '',
        hidden: field('hidden') === 'true',
        pending: field('pending') === 'true',
      }
    })

  // Read already, or not in this collection at all, counts as behind you.
  const inCollection = new Set(topics.map((t) => t.name))
  const behind = new Set(topics.filter((t) => t.reviewed).map((t) => t.name))
  const left = topics.filter((t) => !t.reviewed && !t.hidden)
  const order: PathTopic[] = []
  const rank = (a: (typeof left)[number], b: (typeof left)[number]) =>
    Number(a.pending) - Number(b.pending) || a.needs.length - b.needs.length || a.path.localeCompare(b.path)
  while (left.length) {
    const ready = left.filter((t) => t.needs.every((n) => behind.has(n) || !inCollection.has(n)))
    // A cycle or a missing link: fall back to the plain ranking.
    const next = (ready.length ? ready : left).sort(rank)[0]
    left.splice(left.indexOf(next), 1)
    behind.add(next.name)
    order.push({ path: next.path, title: next.title, content: next.content, needs: next.needs, pending: next.pending })
  }
  return order
}

export async function firstNoteIn(vaultId: string, space: string): Promise<PathTopic | null> {
  return (await topicPath(vaultId, space))[0] ?? null
}
