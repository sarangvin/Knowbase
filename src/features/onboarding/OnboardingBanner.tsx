// One announcement: your space is ready, here is the way in.
//
// It used to carry the whole build — spinner, failure, retry — and now
// carries none of that. A collection being built is a card in the
// collections grid with the topic as its title (see CollectionCard's
// BuildingCard), which is the shape of the thing being made, in the place it
// will appear, one per collection. This bar could only ever say one of them
// at a time, somewhere the collection would never be.
//
// What is left is the part a card cannot do. The moment a space becomes
// real, the reader is usually somewhere else entirely — browsing the demo,
// which is the whole point of building in the background — and "it is ready,
// take me there" has to reach them wherever that is.
//
// It also still runs the status poll, which is the app's only heartbeat:
// draining the draft queue, keeping the vault in sync, and publishing the
// job list the cards are drawn from.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { RemoteVaultSource } from '../../vault/remoteSource'
import {
  fetchOnboardingStatus,
  ackOnboarding,
  workInFlight,
  ONBOARDING_STARTED,
  JOBS_CHANGED,
  WORK_GRACE_MS,
  type OnboardingJob,
} from './onboardingApi'
import { Sparkles, ArrowRight, X } from '../../ui/icons'
import './onboarding.css'

/** Slow enough not to be a background load on a phone, fast enough that the
 *  gap between "done" and "told" isn't itself the new wait. The focus listener
 *  below is what actually covers the common case — a locked phone polls
 *  nothing, and catches up the moment it's picked up. */
const POLL_MS = 5000

/** A slower pass that runs whenever the app is open, whether or not the
 *  poll thinks anything is happening.
 *
 *  The ten-minute cron tops collections up for everybody, drains its own
 *  queue server side, and leaves nothing behind for the poll to notice — so
 *  without this, a tab sitting on Next Up never learns about the notes it
 *  just wrote. One listing request, skipped entirely while the tab is
 *  hidden, and flagged `background` so it does not register as somebody
 *  opening their vault. */
const IDLE_SYNC_MS = 60_000

/** Dismissal is per job *and per state*, not a single "hide the banner" flag.
 *
 *  Closing the spinner says "stop telling me it is building", which is a
 *  reasonable thing to want for something that runs for a minute in the
 *  corner of every screen. It does not say "never tell me it is ready" —
 *  that message is the entire reason the banner exists, and it carries the
 *  button that takes them to the space.
 *
 *  sessionStorage, so a reload mid-build does not put it back, and a new tab
 *  or a new day starts clean. Wrapped: storage throws outright in a
 *  locked-down browser, and the cost of losing this is a banner the user has
 *  to close twice. */
const DISMISS_KEY = 'kb:onboarding-dismissed'

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

export function OnboardingBanner() {
  const user = useVault((s) => s.user)
  const source = useVault((s) => s.source)
  const loadRemote = useVault((s) => s.loadRemote)
  const openNote = useVault((s) => s.openNote)
  const refreshVault = useVault((s) => s.refreshVault)
  const setBuildingJobs = useVault((s) => s.setBuildingJobs)

  const [job, setJob] = useState<OnboardingJob | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  const [busy, setBusy] = useState(false)
  // Survives re-renders so the interval below is never stacked twice.
  const timer = useRef<number | null>(null)

  const approved = user != null && user.accessApproved

  useEffect(() => {
    if (!approved) {
      setJob(null)
      return
    }
    let cancelled = false
    // Whether the previous pass saw work in flight, so the pass that finds
    // the queue empty still syncs once before standing down.
    let wasWorking = false
    // Set when the server is handed work; see WORK_GRACE_MS.
    let graceUntil = 0

    const poll = async () => {
      const { job: next, jobs, queue } = await fetchOnboardingStatus()
      if (cancelled) return
      setJob(next)
      // Published for the collections home, which draws a card per build in
      // progress. Same fetch, so the card and this banner cannot disagree.
      setBuildingJobs(jobs ?? (next ? [next] : []))
      // Two reasons to keep polling, not one.
      //
      // The job being 'running' is the visible one — the banner is counting
      // notes. The other is the draft queue: this poll is the only thing
      // that drains it, and growing a space after a review enqueues work
      // long after the user's own onboarding finished. Stopping then would
      // leave those notes as "Coming soon" until the next time somebody
      // happened to onboard.
      // Grace is part of this one answer rather than a separate branch: it
      // has to keep the interval alive *and* keep the vault in sync, and
      // those are the same condition.
      const working = workInFlight({ job: next, queue, graceUntil })

      // Pull whatever has landed into the open vault. This is what turns
      // "Coming soon" into a readable note, and an empty collection into a
      // filling one, without the page being reloaded.
      //
      // Run one pass *after* the work finishes as well as during it —
      // `wasWorking` — because the last note is written by the same request
      // that reports the queue empty, and stopping on the report would
      // leave exactly that note behind until the next reload. It is a
      // single listing request when nothing has changed.
      if (working || wasWorking) await refreshVault()
      wasWorking = working
      if (cancelled) return

      if (!working && timer.current !== null) {
        clearInterval(timer.current)
        timer.current = null
      }
    }

    void poll()
    timer.current = window.setInterval(() => void poll(), POLL_MS)
    // Backgrounded tabs get their timers throttled hard, and a locked phone
    // runs none at all, so returning to the app is the signal that matters.
    //
    // The vault is synced here unconditionally, not only when the poll finds
    // work in flight. Notes are also written by the ten-minute cron, which
    // drains its own queue server side and so leaves nothing for the poll to
    // see — coming back to the tab is the moment to pick those up. One
    // listing request.
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return
      void refreshVault()
      void poll()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    // A space started elsewhere in the app (the collections home) needs the
    // interval restarted, not just one extra poll — it was cleared when the
    // last job finished.
    const onStarted = () => {
      graceUntil = Date.now() + WORK_GRACE_MS
      void poll()
      if (timer.current === null) timer.current = window.setInterval(() => void poll(), POLL_MS)
    }
    window.addEventListener(ONBOARDING_STARTED, onStarted)

    // One fetch, no window, no interval: the job list changed underneath us
    // and the only thing out of date is what we are holding.
    const onJobsChanged = () => void poll()
    window.addEventListener(JOBS_CHANGED, onJobsChanged)

    const idle = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshVault()
    }, IDLE_SYNC_MS)

    return () => {
      cancelled = true
      if (timer.current !== null) clearInterval(timer.current)
      timer.current = null
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener(ONBOARDING_STARTED, onStarted)
      window.removeEventListener(JOBS_CHANGED, onJobsChanged)
      clearInterval(idle)
    }
  }, [approved, refreshVault, setBuildingJobs])

  const dismissKey = job ? `${job.topic}|${job.status}` : ''
  const dismiss = () => {
    setDismissed(dismissKey)
    try {
      sessionStorage.setItem(DISMISS_KEY, dismissKey)
    } catch {
      // Nothing else depends on it; the in-memory state still holds for this
      // render tree, which is the part the user just asked for.
    }
  }

  if (!job || dismissed === dismissKey) return null
  // Already delivered: they've been to the space, so this is history.
  if (job.status === 'ready' && job.acknowledged) return null

  const openSpace = async () => {
    if (!job.openPath || busy) return
    setBusy(true)
    try {
      // Sync from the server rather than trusting the in-memory index: the
      // notes were written by the server. On a vault that is already open
      // this is the quiet refresh, not `reload()` — reload flashes the
      // full-screen "Digging the tunnels…" and rebuilds the tabs, which is a
      // jarring way to answer a button that says "Open it".
      const alreadyPersonal = source instanceof RemoteVaultSource && source.mode === 'personal'
      if (!alreadyPersonal) await loadRemote()
      else await refreshVault()
      openNote(job.openPath, { replace: true })
      await ackOnboarding(job.topic)
      setJob({ ...job, acknowledged: true })
    } finally {
      setBusy(false)
    }
  }

  // 'running' is deliberately not drawn here any more. A build in progress
  // is a card in the collections grid, with the topic as its title and a
  // spinner where the counts go — the shape of the thing being made, in the
  // place it will appear. A bar at the foot of every screen said the same
  // thing in a place the collection will never be, and said it once however
  // many collections were building.
  if (job.status === 'running') return null

  // 'failed' is not drawn here either, for the same reason 'running' is
  // not: the collection card carries the failure and the retry, in the slot
  // the collection was going to occupy. Both would have shown at once on the
  // collections screen — a banner and a card saying the same thing, which is
  // the duplicate this move was meant to remove rather than double.

  // Ready. The draft count is here rather than hidden because the remaining
  // notes land after this point: saying "5 of 5" once it's true is the
  // difference between a space that looks half-finished and one that is
  // visibly still filling in.
  const stillDrafting = job.notesTotal > 0 && job.notesDrafted < job.notesTotal
  return (
    <div className="ob-banner ready" role="status">
      <Sparkles />
      <div className="ob-banner-text">
        <strong>Your space on {job.space ?? job.topic} is ready</strong>
        <span>
          {stillDrafting
            ? `${job.notesDrafted} of ${job.notesTotal} notes written — the rest are still being drafted.`
            : 'All its notes are written.'}
        </span>
      </div>
      <button className="ob-banner-btn primary" onClick={() => void openSpace()} disabled={busy}>
        {busy ? <span className="spinner" /> : <ArrowRight />} Open it
      </button>
      <button className="ob-banner-dismiss" aria-label="Dismiss" onClick={dismiss}>
        <X />
      </button>
    </div>
  )
}
