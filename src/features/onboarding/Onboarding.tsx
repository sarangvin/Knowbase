// The landing screen. It leads with the product's own question — "what do you
// want to learn?" — rather than a choice between storage backends, which is
// what it used to open with. A newcomer has no idea what a "vault" is, and
// three co-equal buttons offered no recommended path.
//
// The topic is captured BEFORE authentication and carried across the OAuth
// round-trip (see pendingTopic.ts). That ordering matters: previously you had
// to sign in with Google before you could find out you weren't approved yet,
// which spends the user's effort and then rejects them, and told us nothing
// about what they actually wanted.
import { useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { FsAccessVaultSource } from '../../vault/source'
import { requestAccess } from '../../vault/remoteSource'
import { setPendingTopic, clearPendingTopic } from './pendingTopic'
import { startOnboarding } from './onboardingApi'
import { RabbitSolid, Folder, Eye, Cloud, Pencil, Envelope, Check, ArrowRight, Sparkles } from '../../ui/icons'
import './onboarding.css'

export function Onboarding() {
  const status = useVault((s) => s.status)
  const error = useVault((s) => s.error)
  const loadSeed = useVault((s) => s.loadSeed)
  const pickFolder = useVault((s) => s.pickFolder)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const user = useVault((s) => s.user)
  const fsSupported = FsAccessVaultSource.isSupported()

  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestedAt, setRequestedAt] = useState<string | null>(user?.accessRequestedAt ?? null)
  const [localError, setLocalError] = useState<string | null>(null)

  if (status === 'loading') {
    return (
      <div className="onboarding">
        <div className="spinner" />
        <p className="ob-sub">Digging the tunnels…</p>
      </div>
    )
  }

  const awaitingApproval = user != null && !user.accessApproved

  // One button, three meanings — the difference is the user's state, not
  // something they should have to reason about before typing.
  const start = async () => {
    const t = topic.trim()
    if (!t || busy) return
    setLocalError(null)
    setPendingTopic(t)

    if (user == null) {
      loginWithGoogle() // full-page redirect; the topic is waiting when we return
      return
    }
    if (awaitingApproval) {
      setBusy(true)
      try {
        setRequestedAt(await requestAccess())
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
      return
    }
    // Approved: hand the topic to the server and go straight into the demo
    // space while it builds. Nothing below this line waits on a model — the
    // notification is what brings them back (see OnboardingBanner), which is
    // the whole reason the wait could be removed rather than shortened.
    setBusy(true)
    try {
      await startOnboarding(t)
      // Consumed: it lives in the job row now, and leaving it here would let
      // a later boot start the same generation a second time.
      clearPendingTopic()
      await loadSeed()
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const startLabel = user == null ? 'Sign in and start digging' : awaitingApproval ? 'Request early access' : 'Start digging'

  return (
    <div className="onboarding">
      {/* Decorative only — the rings behind the card read as a burrow seen
          from above, and are what makes the landing page feel like the
          entrance to something rather than a generic sign-in. */}
      <div className="ob-burrow" aria-hidden="true">
        <span className="burrow" />
      </div>

      <div className="ob-card">
        <div className="ob-logo">
          <RabbitSolid width={36} height={36} />
        </div>
        <h1 className="ob-title">What do you want to learn?</h1>
        <p className="ob-sub">
          Name a topic and Rabbithole digs the tunnels — the subtopics worth knowing,
          what to study in what order, and a first draft of notes for each.
        </p>

        {error && <div className="ob-error">{error}</div>}
        {localError && <div className="ob-error">{localError}</div>}

        {requestedAt ? (
          <div className="ob-pending">
            <Check /> Request received — we'll let you know when your access is ready.
          </div>
        ) : (
          <div className="ob-primary">
            <input
              className="ob-topic-input"
              autoFocus
              placeholder="e.g. Quantum computing, French cooking, Kubernetes…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void start()}
              disabled={busy}
            />
            <button className="ob-btn primary" disabled={!topic.trim() || busy} onClick={() => void start()}>
              {busy ? <span className="spinner" /> : <ArrowRight />} {startLabel}
            </button>
            {user == null && (
              <p className="ob-hint">You'll sign in with Google so your space is saved to your account.</p>
            )}
            {user != null && !awaitingApproval && (
              <p className="ob-hint">
                <Sparkles /> We'll build it in the background while you look around a finished one.
              </p>
            )}
            {awaitingApproval && (
              <p className="ob-hint">
                <Envelope /> Rabbithole is in early access. Tell us your topic and we'll add you to the list.
              </p>
            )}
          </div>
        )}

        {/* Everything below is deliberately secondary: these are the escape
            hatches and the returning-user paths, not the main road. */}
        <div className="ob-secondary">
          <button className="ob-linklike" onClick={() => void loadSeed()}>
            <Eye /> Explore a finished warren
          </button>
          {user != null && !awaitingApproval && (
            <button className="ob-linklike" onClick={() => void loadRemote()}>
              <Cloud /> Open my cloud vault
            </button>
          )}
          {user?.role === 'owner' && (
            <button className="ob-linklike" onClick={() => void loadGlobalVault()}>
              <Pencil /> Edit the global vault
            </button>
          )}
          {fsSupported && (
            <button className="ob-linklike" onClick={() => void pickFolder()}>
              <Folder /> Open my own folder
            </button>
          )}
        </div>

        {!fsSupported && (
          <p className="ob-note">
            Tip: open in Chrome or Edge to load your own folder with read/write access.
          </p>
        )}
        {user && (
          <p className="ob-note">
            Signed in as {user.email} ·{' '}
            <button className="ob-linklike inline" onClick={() => void logout()}>
              sign out
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
