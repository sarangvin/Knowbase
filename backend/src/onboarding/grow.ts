// Keeps a space from running out of things to learn.
//
// Triggered when someone marks a note reviewed. What it tops up is no longer
// the shelf the reader can see: that is refilled instantly by revealing one
// of the notes already written and waiting (see vault/hidden.ts). This tops
// up *those* — the hidden buffer behind the shelf — which is the slow part
// and is now nobody's wait.
//
// The caps are the point. Three visible keeps a next step always available
// without turning the sidebar into a backlog nobody will ever finish; an
// infinite queue of unread material is demotivating in a way that three is
// not. Three hidden is one reveal per completion with two spare, so the
// buffer survives a couple of failed generations without the reader ever
// seeing an empty shelf.
import { and, eq, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes } from '../db/schema.js'
import { generateNextTopics } from './plan.js'
import { enqueueDrafts } from './queue.js'
import { buildTopicNote, dedupeSegments, sanitizeSegment } from './notePlan.js'
import { SPACE_ROOT, getOrCreatePersonalVaultId, archivedSpaces } from '../vault/spaces.js'
import { HIDDEN_BUFFER, VISIBLE_AHEAD, isHidden, isReviewed, revealUpTo } from '../vault/hidden.js'
import { logUsageEvent } from '../usage/logEvent.js'

/** How many unstudied topics a space should keep available.
 *
 *  Kept as a name because several callers still ask "is this collection
 *  short?" — it is VISIBLE_AHEAD, which is where the number now lives. */
export const MAX_UNREVIEWED = VISIBLE_AHEAD

/** Ceiling on a single grow run, independent of the cap above: a vault whose
 *  frontmatter is malformed enough to read as zero unreviewed topics must not
 *  turn one click into an unbounded generation run. */
const MAX_PER_RUN = 3

function titleFromPath(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '')
}

export interface GrowResult {
  added: number
  reason?: 'enough-unreviewed' | 'archived' | 'no-space' | 'no-key' | 'generation-failed'
}

/** What the buffer needs, given what is there.
 *
 *  Both shelves are counted and the shortfalls added, because a reader who
 *  has just finished a note has one gap on the visible shelf that a reveal
 *  is about to fill from the hidden one — so the hidden shelf is two short,
 *  not one, and generating for only the gap you can see means the buffer
 *  drains by one with every note finished until it is empty.
 */
export function wanted(visible: number, hidden: number): number {
  const visibleGap = Math.max(0, VISIBLE_AHEAD - visible)
  // A reveal can cover at most as many as are actually waiting.
  const fromBuffer = Math.min(visibleGap, hidden)
  const hiddenAfter = hidden - fromBuffer
  const visibleAfter = visible + fromBuffer
  return Math.max(0, HIDDEN_BUFFER - hiddenAfter) + Math.max(0, VISIBLE_AHEAD - visibleAfter)
}

/**
 * Never throws. The only caller is a fire-and-forget background job kicked off
 * by someone pressing "Mark reviewed" — a failure here must not become an
 * error on an action that already succeeded.
 */
export async function growSpace(userId: string, space: string): Promise<GrowResult> {
  try {
    const vaultId = await getOrCreatePersonalVaultId(userId)

    // An archived collection is one the reader has set aside. Growing it
    // would spend model calls filling a shelf they just closed — and put
    // "Coming soon" notes into something that is not on screen.
    if ((await archivedSpaces(vaultId)).has(space)) return { added: 0, reason: 'archived' }
    const prefix = `${SPACE_ROOT}${space}/Topics/`

    const rows = await db
      .select({ path: notes.path, content: notes.content })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${prefix}%`)))

    if (rows.length === 0) return { added: 0, reason: 'no-space' }

    // Every title in the space, hidden ones included: the model must not be
    // asked for a topic that already exists just because the reader cannot
    // see it yet, and a filename collision does not care either.
    const all = rows.map((r) => titleFromPath(r.path))
    // "Reviewed" is last_reviewed being set, which is exactly what the Mark
    // reviewed button writes. Confidence is deliberately not used: someone can
    // drag that slider without having read anything.
    const studied = rows.filter((r) => isReviewed(r.content)).map((r) => titleFromPath(r.path))
    const hiddenCount = rows.filter((r) => isHidden(r.content)).length
    const visible = rows.filter((r) => !isHidden(r.content) && !isReviewed(r.content)).length

    const want = Math.min(wanted(visible, hiddenCount), MAX_PER_RUN)
    if (want === 0) return { added: 0, reason: 'enough-unreviewed' }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return { added: 0, reason: 'no-key' }

    const fresh = await generateNextTopics(space, studied, all, want, userId)
    if (!fresh || fresh.length === 0) {
      // Recorded, not just logged. Growth happens behind a fire-and-forget
      // request with nobody watching, so when it silently does nothing the
      // only evidence used to be a console.warn in a serverless log. A row
      // here is what let "why are no topics generating" be answered from
      // the database instead of guessed at.
      void logUsageEvent({
        userId,
        eventType: 'vault_sync',
        metadata: { space, source: 'grow', outcome: 'generation-failed', want },
      })
      return { added: 0, reason: 'generation-failed' }
    }

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

    // Written hidden, always. Generation is the slow part and the buffer
    // exists to keep it off the reader's path; a note that appeared on the
    // shelf the moment it was planned would be a "Coming soon" row again,
    // which is the thing this replaces. vault/hidden.ts hands them over.
    const placeholders = fresh.map((s) => buildTopicNote(s.title, s, null, { pending: true, hidden: true }))
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
      metadata: { vault: 'personal', space, count: fresh.length, source: 'grow', hidden: true },
    })

    // A shelf can be short *and* the buffer empty — a collection whose last
    // few generations failed, or one from before the buffer existed. The
    // notes just written are the first thing it has had to offer, so top the
    // shelf up from them rather than making the reader wait for a review
    // they have nothing to review. Normally a no-op: the shelf is full.
    await revealUpTo(vaultId, space)

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
