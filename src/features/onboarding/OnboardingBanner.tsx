// The other half of moving generation off the critical path: if nobody is
// watching a spinner, something has to tell them when their space is ready.
//
// It sits above the bottom nav on every screen of the app, because the user is
// somewhere else entirely while this runs — browsing the demo space, which is
// the whole point — and there is no single screen they can be relied on to be
// looking at.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { RemoteVaultSource } from '../../vault/remoteSource'
import { startOnboarding, fetchOnboardingJob, ackOnboarding, ONBOARDING_STARTED, type OnboardingJob } from './onboardingApi'
import { Sparkles, ArrowRight, X, RotateCw } from '../../ui/icons'
import './onboarding.css'

/** Slow enough not to be a background load on a phone, fast enough that the
 *  gap between "done" and "told" isn't itself the new wait. The focus listener
 *  below is what actually covers the common case — a locked phone polls
 *  nothing, and catches up the moment it's picked up. */
const POLL_MS = 5000

export function OnboardingBanner() {
  const user = useVault((s) => s.user)
  const source = useVault((s) => s.source)
  const loadRemote = useVault((s) => s.loadRemote)
  const openNote = useVault((s) => s.openNote)

  const [job, setJob] = useState<OnboardingJob | null>(null)
  const [dismissed, setDismissed] = useState(false)
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

    const poll = async () => {
      const next = await fetchOnboardingJob()
      if (cancelled) return
      setJob(next)
      // Stop the moment there is nothing left to wait for. A finished job
      // doesn't change again until the user starts another one, and that path
      // sets state directly.
      if (next?.status !== 'running' && timer.current !== null) {
        clearInterval(timer.current)
        timer.current = null
      }
    }

    void poll()
    timer.current = window.setInterval(() => void poll(), POLL_MS)
    // Backgrounded tabs get their timers throttled hard, and a locked phone
    // runs none at all, so returning to the app is the signal that matters.
    const onFocus = () => void poll()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    // A space started elsewhere in the app (the collections home) needs the
    // interval restarted, not just one extra poll — it was cleared when the
    // last job finished.
    const onStarted = () => {
      void poll()
      if (timer.current === null) timer.current = window.setInterval(() => void poll(), POLL_MS)
    }
    window.addEventListener(ONBOARDING_STARTED, onStarted)

    return () => {
      cancelled = true
      if (timer.current !== null) clearInterval(timer.current)
      timer.current = null
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener(ONBOARDING_STARTED, onStarted)
    }
  }, [approved])

  if (!job || dismissed) return null
  // Already delivered: they've been to the space, so this is history.
  if (job.status === 'ready' && job.acknowledged) return null

  const openSpace = async () => {
    if (!job.openPath || busy) return
    setBusy(true)
    try {
      // Always reload from the server rather than trusting the in-memory
      // index: the notes were written by the server, so a client that has had
      // this vault open the whole time has never heard of them.
      const alreadyPersonal = source instanceof RemoteVaultSource && source.mode === 'personal'
      if (!alreadyPersonal) await loadRemote()
      else await useVault.getState().reload()
      openNote(job.openPath, { replace: true })
      await ackOnboarding()
      setJob({ ...job, acknowledged: true })
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (busy) return
    setBusy(true)
    try {
      setJob(await startOnboarding(job.topic))
    } catch (err) {
      setJob({ ...job, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  if (job.status === 'running') {
    return (
      <div className="ob-banner" role="status">
        <span className="spinner" />
        <div className="ob-banner-text">
          <strong>Building your space on {job.topic}</strong>
          <span>Have a look around this one meanwhile — we'll tell you when yours is ready.</span>
        </div>
      </div>
    )
  }

  if (job.status === 'failed') {
    return (
      <div className="ob-banner failed" role="alert">
        <div className="ob-banner-text">
          <strong>Couldn't build your space on {job.topic}</strong>
          <span>{job.error ?? 'Something went wrong on our side.'}</span>
        </div>
        <button className="ob-banner-btn" onClick={() => void retry()} disabled={busy}>
          <RotateCw /> Try again
        </button>
        <button className="ob-banner-dismiss" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X />
        </button>
      </div>
    )
  }

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
      <button className="ob-banner-dismiss" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X />
      </button>
    </div>
  )
}
