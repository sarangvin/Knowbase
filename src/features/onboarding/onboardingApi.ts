// The client's whole view of space generation now that it doesn't do any:
// start one, ask whether it's ready, say it's been seen.
//
// What used to be here — prompt building, JSON validation, six model calls and
// the note format — is gone, not moved. It lives in backend/src/onboarding/,
// because work that only happens while a tab is open is work that silently
// doesn't happen when someone locks their phone.
import { localDay } from '../automated-graph/engine'

export interface OnboardingJob {
  topic: string
  status: 'running' | 'ready' | 'failed'
  space: string | null
  /** Where to land them once it's ready. Null until the notes exist. */
  openPath: string | null
  /** Set when status is 'failed'. Written by the server to be shown verbatim. */
  error: string | null
  notesTotal: number
  notesDrafted: number
  /** True once they've been taken to the space — the notification is done. */
  acknowledged: boolean
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    /* non-JSON body — fall through to the generic line */
  }
  return fallback
}

/** Kick off generation. Resolves as soon as the server has accepted the job,
 *  which is the point: nothing downstream of this waits on a model. */
export async function startOnboarding(topic: string): Promise<OnboardingJob> {
  const res = await fetch('/api/onboarding/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    // The day goes with it: the daily cap is counted in the user's own
    // calendar day, like every other limit here.
    body: JSON.stringify({ topic, day: localDay() }),
  })
  if (!res.ok) throw new Error(await readError(res, `Could not start building your space (${res.status}).`))
  const { job } = (await res.json()) as { job: OnboardingJob }
  // The poll stops once nothing is running, so a job started from anywhere
  // other than the banner itself would go unnoticed until the tab next
  // regained focus. Tell it directly.
  announceServerWork()
  return job
}

/** Fired when the server has been given work that will write notes, so the
 *  status poll can restart and the vault can pick them up as they land.
 *
 *  Two things raise it: starting a collection, and asking a space to grow
 *  after a review. Both enqueue drafting, and the poll is what drains the
 *  queue *and* what notices the result — so without this, finishing a note
 *  would leave the next three sitting as "Coming soon" until the tab
 *  happened to regain focus.
 *
 *  The event name still says "onboarding" because it is persisted nowhere
 *  and renaming a string costs nothing, but it is not onboarding-specific.
 */
export const ONBOARDING_STARTED = 'rabbithole:onboarding-started'

export function announceServerWork(): void {
  window.dispatchEvent(new CustomEvent(ONBOARDING_STARTED))
}

/** How long to keep watching after the server has been handed work, even
 *  while nothing is visibly happening yet.
 *
 *  This is the number the whole "notes appear by themselves" behaviour turns
 *  on. `POST /api/onboarding/grow` answers 202 straight away and *then*
 *  spends up to two twenty-second plan calls before it writes a single row.
 *  So the poll fired the instant a note is reviewed finds no job running and
 *  an empty queue — the honest state of the world at that moment — and
 *  without a grace window it concludes there is nothing to watch and stands
 *  down about forty seconds before the placeholders exist. Nothing polls
 *  again, so nothing drains the queue and nothing re-lists the vault: the
 *  next topics stay invisible until the page is reloaded.
 *
 *  Two minutes covers both plan attempts, the writes, and several drains
 *  after them. */
export const WORK_GRACE_MS = 120_000

/** Is there still a reason to poll?
 *
 *  Pulled out of the banner and given a name because getting it wrong is
 *  invisible: everything still works, notes just quietly stop appearing.
 *  The three clauses are three different ways of having work in flight —
 *  one the server admits to, one sitting in the queue, and one that has been
 *  promised but not yet started.
 */
export function workInFlight(o: {
  job: OnboardingJob | null
  queue?: QueueDepth
  /** Date.now() + WORK_GRACE_MS, set when work was last announced. */
  graceUntil: number
  now?: number
}): boolean {
  if (o.job?.status === 'running') return true
  if (o.queue && o.queue.pending + o.queue.running > 0) return true
  return (o.now ?? Date.now()) < o.graceUntil
}

/** Null when there's nothing to report: no job, or the caller isn't approved
 *  (403) and so has nothing being built for them. Never throws — this is
 *  polled, and a blip must not surface as an error next to the user's notes. */
export interface QueueDepth {
  pending: number
  running: number
  failed: number
}

export interface OnboardingStatus {
  job: OnboardingJob | null
  /** Outstanding note drafting, across everyone. The poll is the only
   *  heartbeat the draft queue has, so the banner keeps polling while this
   *  is non-empty even when the caller's own job finished long ago. */
  queue?: QueueDepth
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  try {
    const res = await fetch('/api/onboarding/status', { credentials: 'include' })
    if (!res.ok) return { job: null }
    return (await res.json()) as OnboardingStatus
  } catch {
    return { job: null }
  }
}

export async function fetchOnboardingJob(): Promise<OnboardingJob | null> {
  return (await fetchOnboardingStatus()).job
}

/** Mark the notification as delivered. Best-effort: the worst case of a
 *  failure here is the banner appearing once more, which is not worth
 *  interrupting the user who has just arrived in their new space. */
export async function ackOnboarding(): Promise<void> {
  try {
    await fetch('/api/onboarding/ack', { method: 'POST', credentials: 'include' })
  } catch {
    /* ignored on purpose — see above */
  }
}

/** Ask the server to top this space back up after a note was reviewed.
 *
 * Fire-and-forget by design: the review itself has already been saved, and a
 * failure to queue more topics is not something to put in front of someone
 * who just finished reading. The server decides whether anything is actually
 * needed — the client does not count anything.
 */
export function requestSpaceGrowth(space: string): void {
  void fetch('/api/onboarding/grow', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space }),
  }).catch((err) => console.warn('[grow] could not request more topics:', err))
  // Announced immediately rather than on the response: the request is
  // fire-and-forget, and the poll it restarts is what will report what
  // actually happened.
  announceServerWork()
}

export interface CollectionAllowance {
  /** null means no limit on this plan, not zero. */
  limits: { active: number | null; perDay: number | null }
  activeCount: number
  startedToday: number
  /** Null when they may start one; otherwise why not, ready to show. */
  blocked: string | null
}

/** Null when the question cannot be answered — not signed in, not approved,
 *  offline. The launcher treats that as "let them try": being refused by the
 *  server is a better outcome than being blocked by a failed lookup. */
export async function fetchCollectionAllowance(): Promise<CollectionAllowance | null> {
  try {
    const res = await fetch(`/api/onboarding/allowance?day=${encodeURIComponent(localDay())}`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    return (await res.json()) as CollectionAllowance
  } catch {
    return null
  }
}
