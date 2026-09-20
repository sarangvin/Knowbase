// The client's whole view of space generation now that it doesn't do any:
// start one, ask whether it's ready, say it's been seen.
//
// What used to be here — prompt building, JSON validation, six model calls and
// the note format — is gone, not moved. It lives in backend/src/onboarding/,
// because work that only happens while a tab is open is work that silently
// doesn't happen when someone locks their phone.

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
    body: JSON.stringify({ topic }),
  })
  if (!res.ok) throw new Error(await readError(res, `Could not start building your space (${res.status}).`))
  const { job } = (await res.json()) as { job: OnboardingJob }
  return job
}

/** Null when there's nothing to report: no job, or the caller isn't approved
 *  (403) and so has nothing being built for them. Never throws — this is
 *  polled, and a blip must not surface as an error next to the user's notes. */
export async function fetchOnboardingJob(): Promise<OnboardingJob | null> {
  try {
    const res = await fetch('/api/onboarding/status', { credentials: 'include' })
    if (!res.ok) return null
    const { job } = (await res.json()) as { job: OnboardingJob | null }
    return job
  } catch {
    return null
  }
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
}
