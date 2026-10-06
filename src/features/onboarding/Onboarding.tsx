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
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setPendingTopic, clearPendingTopic, peekPendingTopic } from './pendingTopic'
import { startOnboarding } from './onboardingApi'
import { randomTopicPlaceholder } from './examples'
import { CollectionSuggestion } from './CollectionSuggestion'
import { RabbitSolid, Eye, Cloud, Pencil, ArrowRight, Sparkles, User } from '../../ui/icons'
import './onboarding.css'

export function Onboarding() {
  const status = useVault((s) => s.status)
  const error = useVault((s) => s.error)
  const loadSeed = useVault((s) => s.loadSeed)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const user = useVault((s) => s.user)

  // Pre-filled from the handoff, so coming back from Google never shows an
  // empty box. The automatic start below usually means this is never seen,
  // but it is what makes "type it once" true when the start cannot fire —
  // an account still waiting on approval, most of all.
  const [topic, setTopic] = useState(() => peekPendingTopic() ?? '')
  const [examples] = useState(randomTopicPlaceholder)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // One button, two meanings — signed out or signed in — and the difference
  // is the user's state, not something they should have to reason about
  // before typing. There used to be a third, "request early access", for
  // accounts awaiting approval; approval became higher limits rather than a
  // way in (the 'new' tier in backend/src/plans.ts), so every signed-in
  // account starts its collection the same way.
  const start = async (override?: string) => {
    const t = (override ?? topic).trim()
    if (!t || busy) return
    setLocalError(null)
    setPendingTopic(t)

    if (user == null) {
      loginWithGoogle() // full-page redirect; the topic is waiting when we return
      return
    }
    // Signed in: hand the topic to the server and go to their own Learn home,
    // where the collection appears as a card and its notes tick off as they
    // are written. This used to open the demo (Economics) to fill the wait,
    // but a build now takes seconds, and the demo read as being sent to the
    // wrong subject.
    setBusy(true)
    try {
      await startOnboarding(t)
      // Consumed: it lives in the job row now, and leaving it here would let
      // a later boot start the same generation a second time.
      clearPendingTopic()
      await loadRemote({ home: true })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  // Coming back from Google with a topic already given: build it, rather
  // than presenting the same question a second time. App.tsx does this too,
  // on the boot path; this covers every way the landing screen can end up
  // rendered for an approved user who has already answered — the redirect
  // resolving after boot, a reload mid-flow, an earlier start that failed.
  //
  // Guarded by a ref rather than state: an effect that can fire twice would
  // spend six model calls twice.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current || busy || user == null) return
    const pending = peekPendingTopic()
    if (!pending) return
    autoStarted.current = true
    void start(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Every hook is above this line, deliberately. An early return placed
  // before a useRef/useEffect is a hook-order violation that only shows up
  // once the component renders in both states — which here meant the whole
  // landing screen crashing the first time `status` settled out of
  // 'loading'. React's message for it names the symptom, not the cause:
  // "Rendered fewer hooks than expected."
  if (status === 'loading') {
    return (
      <div className="onboarding">
        <div className="spinner" />
        <p className="ob-sub">Digging the tunnels…</p>
      </div>
    )
  }

  // "Sign up", because that is what the button does for someone who has
  // never been here: it takes a topic and makes an account to hang it on.
  // Signing in to an account you already have is the link below, which
  // carries no topic.
  const startLabel = user == null ? 'Sign up and start digging' : 'Start digging'

  // Google either way — there is one identity provider and it decides for
  // itself whether this is a new account. The difference that matters to
  // the user is what happens next: a new topic, or the vault they left.
  // Clearing the handoff is the whole of it: without that, whatever is in
  // the box would start generating on arrival for someone who only wanted
  // to get back in.
  const logIn = () => {
    clearPendingTopic()
    loginWithGoogle()
  }

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

        <div className="ob-primary">
            <input
              className="ob-topic-input"
              autoFocus
              placeholder={examples}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void start()}
              disabled={busy}
            />
            <button className="ob-btn primary" disabled={!topic.trim() || busy} onClick={() => void start()}>
              {busy ? <span className="spinner" /> : <ArrowRight />} {startLabel}
            </button>
            {user == null && (
              <p className="ob-hint">You'll sign up with Google so your space is saved to your account.</p>
            )}
            {user != null && (
              <p className="ob-hint">
                <Sparkles /> Your notes appear on your Learn page as they're written.
              </p>
            )}
          </div>

        {/* The alternative to naming a subject: one somebody already had
            written, picked at random, with "Show another" to re-roll. It
            starts through the same path as a typed topic, so a newcomer
            signs up first and the library copy is waiting when they land. */}
        <div className="home-suggestion">
          <CollectionSuggestion
            owned={[]}
            building={[]}
            title="Or start an existing collection"
            onStart={(name) => void start(name)}
          />
        </div>

        {/* Everything below is deliberately secondary: these are the escape
            hatches and the returning-user paths, not the main road. */}
        <div className="ob-secondary">
          {user == null && (
            <button className="ob-linklike" onClick={logIn}>
              <User /> Log in to an existing account
            </button>
          )}
          <button className="ob-linklike" onClick={() => void loadSeed()}>
            <Eye /> Explore a finished warren
          </button>
          {user != null && (
            <button className="ob-linklike" onClick={() => void loadRemote()}>
              <Cloud /> Open my cloud vault
            </button>
          )}
          {user?.role === 'owner' && (
            <button className="ob-linklike" onClick={() => void loadGlobalVault()}>
              <Pencil /> Edit the global vault
            </button>
          )}
        </div>

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
