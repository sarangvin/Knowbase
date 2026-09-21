// "What do you want to learn?" — the input that starts a space, reusable
// anywhere inside the app.
//
// The landing screen asks this before sign-in. This is the same question
// asked afterwards: on an empty vault (where the alternative was staring at
// "0 notes" with no way forward) and on the collections home, where it adds
// another collection rather than the first.
//
// It does not wait for anything. Generation is server-side, so the moment the
// job is accepted the user can carry on reading; OnboardingBanner tells them
// when the space is ready, from wherever they happen to be.
import { useEffect, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { startOnboarding, fetchCollectionAllowance, type CollectionAllowance } from './onboardingApi'
import { randomTopicPlaceholder } from './examples'
import { Sparkles, ArrowRight } from '../../ui/icons'

export function TopicLauncher({
  title,
  hint,
  placeholder,
}: {
  title: string
  hint?: string
  placeholder?: string
}) {
  const user = useVault((s) => s.user)
  const [topic, setTopic] = useState('')
  // Rolled once per mount. Re-rolling on render would shuffle the examples
  // under the cursor while someone is still reading them.
  const [examples] = useState(randomTopicPlaceholder)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Null means "we could not ask" as well as "not asked yet", and both are
  // treated as permission: the server refuses for real, and a failed lookup
  // must not be what stops somebody starting a collection.
  const [allowance, setAllowance] = useState<CollectionAllowance | null>(null)

  const approved = !!user?.accessApproved

  // Re-read after every start, because starting one is exactly what uses
  // the allowance up.
  useEffect(() => {
    if (!approved) return
    let cancelled = false
    void fetchCollectionAllowance().then((a) => !cancelled && setAllowance(a))
    return () => {
      cancelled = true
    }
  }, [approved, started])

  // Generation spends the owner's model key, so the server refuses an
  // unapproved account. Saying so here beats letting them type a topic and
  // then handing back a 403.
  if (!approved) return null

  const submit = async () => {
    const t = topic.trim()
    if (!t || busy) return
    setBusy(true)
    setError(null)
    try {
      await startOnboarding(t)
      setStarted(t)
      setTopic('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (started) {
    return (
      <div className="launcher launcher-started">
        <Sparkles width={15} height={15} />
        <span>
          Building <strong>{started}</strong> — you'll be told when it's ready. Keep reading
          meanwhile.
        </span>
        <button className="ob-linklike inline" onClick={() => setStarted(null)}>
          Add another
        </button>
      </div>
    )
  }

  // Said before they type, not after. Being asked for a topic and then
  // refused is the shape of a form that wasted your time.
  if (allowance?.blocked) {
    return (
      <div className="launcher">
        <div className="launcher-title">{title}</div>
        <p className="launcher-hint">{allowance.blocked}</p>
      </div>
    )
  }

  return (
    <div className="launcher">
      <div className="launcher-title">{title}</div>
      {hint && <p className="launcher-hint">{hint}</p>}
      <div className="launcher-row">
        <input
          className="ob-topic-input"
          placeholder={placeholder ?? examples}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          disabled={busy}
        />
        <button className="ob-btn primary launcher-go" disabled={!topic.trim() || busy} onClick={() => void submit()}>
          {busy ? <span className="spinner" /> : <ArrowRight />} {busy ? 'Starting…' : 'Build it'}
        </button>
      </div>
      {error && <div className="ob-error launcher-error">{error}</div>}
      {allowance && allowance.limits.perDay - allowance.startedToday <= 1 && (
        <p className="launcher-hint">
          {allowance.limits.perDay - allowance.startedToday} new collection left today.
        </p>
      )}
    </div>
  )
}
