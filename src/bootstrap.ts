// The app's opening requests, as one (backend/src/routes/bootstrap.ts).
//
// Streak, collection allowance, library spaces, onboarding status and
// reminder settings are each fetched by their own part of the app, and as it
// opens they all ask at once. The first of them to ask here starts a single
// /api/bootstrap request; every one asking while it is in flight, or within
// SHARE_MS of its answer, gets its part from that answer instead of making a
// request of its own — two components wanting the allowance as the app
// opens share it. After that, refreshes and polls go to their own routes,
// as before; the window is shorter than the quickest poll (five seconds),
// so no poll is ever answered with the opening's data.
//
// Undefined means "fetch it yourself": the answer is past SHARE_MS, the part
// came back null, or the bootstrap request failed (an older server,
// offline). Callers fall back to their own request, so this can only ever
// save requests, never lose data.
import { localDay } from './features/automated-graph/engine'

type Part = 'streak' | 'coins' | 'allowance' | 'library' | 'onboarding' | 'notifications'

const SHARE_MS = 2_000
/** Only the app's opening is worth a bootstrap; a first ask after this
 *  (opening Settings minutes in) just makes its own request. */
const OPENING_MS = 10_000

let started: Promise<{ at: number; parts: Partial<Record<Part, unknown>> } | null> | null = null

export async function fromBootstrap<T>(part: Part): Promise<T | undefined> {
  if (!started && performance.now() > OPENING_MS) return undefined
  started ??= fetch(`/api/bootstrap?day=${encodeURIComponent(localDay())}`, { credentials: 'include' })
    .then(async (res) => (res.ok ? { at: Date.now(), parts: await res.json() } : null))
    .catch(() => null)
  const boot = await started
  if (!boot || Date.now() - boot.at > SHARE_MS) return undefined
  return (boot.parts[part] ?? undefined) as T | undefined
}
