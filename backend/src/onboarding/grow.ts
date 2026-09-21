// Keeps a space from running out of things to learn.
//
// Triggered when someone marks a note reviewed: if that leaves them fewer
// than MAX_UNREVIEWED topics they have not studied, new ones are generated
// behind them, with prerequisites drawn from what they now know.
//
// The cap is the point. Topping a tree back up to three keeps a next step
// always available without turning the sidebar into a backlog nobody will
// ever finish — an infinite queue of unread material is demotivating in a way
// that three is not.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { generateNextTopics } from './plan.js'
import { enqueueDrafts } from './queue.js'
import { buildTopicNote, dedupeSegments, sanitizeSegment } from './notePlan.js'
import { SPACE_ROOT, getOrCreatePersonalVaultId } from '../vault/spaces.js'
import { frontmatterValue } from '../vault/frontmatter.js'
import { logUsageEvent } from '../usage/logEvent.js'

/** How many unstudied topics a space should keep available. */
export const MAX_UNREVIEWED = 3

/** Ceiling on a single grow run, independent of the cap above: a vault whose
 *  frontmatter is malformed enough to read as zero unreviewed topics must not
 *  turn one click into an unbounded generation run. */
const MAX_PER_RUN = 3

function titleFromPath(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

export interface GrowResult {
  added: number
  reason?: 'enough-unreviewed' | 'no-space' | 'no-key' | 'generation-failed'
}

/**
 * Never throws. The only caller is a fire-and-forget background job kicked off
 * by someone pressing "Mark reviewed" — a failure here must not become an
 * error on an action that already succeeded.
 */
export async function growSpace(userId: string, space: string): Promise<GrowResult> {
  try {
    const vaultId = await getOrCreatePersonalVaultId(userId)
    const prefix = `${SPACE_ROOT}${space}/Topics/`

    const rows = await db
      .select({ path: notes.path, content: notes.content })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${prefix}%`)))

    if (rows.length === 0) return { added: 0, reason: 'no-space' }

    const all = rows.map((r) => titleFromPath(r.path))
    // "Reviewed" is last_reviewed being set, which is exactly what the Mark
    // reviewed button writes. Confidence is deliberately not used: someone can
    // drag that slider without having read anything.
    const studied = rows.filter((r) => !!frontmatterValue(r.content, 'last_reviewed')).map((r) => titleFromPath(r.path))
    const unreviewed = all.length - studied.length

    if (unreviewed >= MAX_UNREVIEWED) return { added: 0, reason: 'enough-unreviewed' }
    const want = Math.min(MAX_UNREVIEWED - unreviewed, MAX_PER_RUN)

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return { added: 0, reason: 'no-key' }

    const fresh = await generateNextTopics(space, studied, all, want, userId)
    if (!fresh || fresh.length === 0) return { added: 0, reason: 'generation-failed' }

    // Disambiguate against every filename already in the space, not just this
    // batch, so a new topic can never overwrite an existing note.
    const existingSegments = new Set(rows.map((r) => r.path.slice(prefix.length).replace(/\.md$/i, '')))
    const segments = dedupeSegments(fresh.map((s) => s.title)).map((seg) => {
      let candidate = seg
      let n = 2
      while (existingSegments.has(candidate)) candidate = `${sanitizeSegment(seg, 60, 'Topic')} ${n++}`
      existingSegments.add(candidate)
      return candidate
    })

    const placeholders = fresh.map((s) => buildTopicNote(s.title, s, null, { pending: true }))
    const paths = segments.map((seg) => `${prefix}${seg}.md`)

    await db
      .insert(notes)
      .values(
        paths.map((path, i) => ({
          vaultId,
          path,
          content: placeholders[i],
          sizeBytes: Buffer.byteLength(placeholders[i], 'utf8'),
          mtime: new Date(),
        })),
      )
      .onConflictDoNothing({ target: [notes.vaultId, notes.path] })

    // Hand the bodies to the queue rather than drafting them here. Growing a
    // space used to draft inline, which meant the work only existed for as
    // long as this one invocation did: overrun the function's time limit or
    // get killed, and the placeholders stayed placeholders with nothing
    // anywhere that knew to retry. Queued, they survive that.
    const siblings = [...all, ...fresh.map((s) => s.title)]
    await enqueueDrafts(
      fresh.map((s, i) => ({
        userId,
        vaultId,
        path: paths[i],
        space,
        title: s.title,
        summary: s.summary,
        siblings,
        source: 'grow',
      })),
    )

    void logUsageEvent({
      userId,
      eventType: 'note_write',
      metadata: { vault: 'personal', space, count: fresh.length, source: 'grow' },
    })

    // Enqueue and stop. This used to `await drainQueue()` here, which put
    // the drafting back inside the very invocation the queue exists to get
    // it out of: one plan call plus three drafts, against a 60s ceiling,
    // where a single draft has been seen taking 28s. That is the timeout.
    //
    // Nothing is lost by not draining — the status poll drains every few
    // seconds, and reconcileQueue sweeps anything the queue loses track of.
    // Grow's job is to decide *what* to write, not to write it.
    return { added: fresh.length }
  } catch (err) {
    console.error('[grow] failed', err)
    return { added: 0, reason: 'generation-failed' }
  }
}
