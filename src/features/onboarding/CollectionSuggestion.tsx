// "Start an existing collection" — one collection from the shared library,
// picked at random each time the Learn tab opens.
//
// The library is every collection anyone has already had written. Starting
// one from here is a copy, not a generation: it is ready in seconds rather
// than a minute, and it costs none of the model budget a brand-new topic
// does. It goes through the same start call as typing a topic — the server
// checks the library first, and the exact name is a guaranteed hit — so it
// gets the same collection cap, the same building card and the same landing.
//
// Random rather than ranked, by request: the point is to show someone a
// subject they would not have thought to type. A different one each visit,
// and "Show another" for when this one does not land.
import { useEffect, useMemo, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import {
  fetchLibrarySpaces,
  startOnboarding,
  fetchCollectionAllowance,
  type CollectionAllowance,
  type LibrarySpace,
} from './onboardingApi'
import { ArrowRight, RotateCw, Sparkles } from '../../ui/icons'

/** Below this the library copy is too thin to be worth suggesting — a space
 *  whose run died after two topics is not a collection anyone should be
 *  steered into. */
const MIN_TOPICS = 3

/** The same key the server matches topics by, so "already have it" means
 *  the same thing on both sides. */
function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** "System Architecture for PMs 2" -> "System Architecture for PMs". A
 *  trailing number is how a second build of a subject someone already has
 *  gets named (disambiguateSpace on the server), so for "have they got this
 *  subject?" the number is not part of the subject. */
function baseOf(s: string): string {
  const m = s.match(/^(.*\S) (\d+)$/)
  return m ? m[1] : s
}

/** The last one shown, across visits to the tab in this session, so that
 *  coming back does not land on the same suggestion by chance. */
let lastShown: string | null = null

function pickRandom(list: LibrarySpace[], avoid: string | null): LibrarySpace | null {
  if (list.length === 0) return null
  const pool = list.length > 1 && avoid ? list.filter((s) => s.key !== avoid) : list
  return pool[Math.floor(Math.random() * pool.length)]
}

export function CollectionSuggestion({
  owned,
  building,
}: {
  /** Every collection the reader already has, archived ones included —
   *  suggesting something you set aside is not a suggestion. */
  owned: string[]
  /** Topics currently being built, so a collection that is on its way is
   *  not offered again in the meantime. */
  building: string[]
}) {
  const user = useVault((s) => s.user)
  const approved = !!user?.accessApproved

  const [library, setLibrary] = useState<LibrarySpace[] | null>(null)
  const [current, setCurrent] = useState<LibrarySpace | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allowance, setAllowance] = useState<CollectionAllowance | null>(null)

  // Fetched on mount — that is, each time the Learn tab is opened, which is
  // what makes the pick a fresh one per visit.
  useEffect(() => {
    if (!approved) return
    let cancelled = false
    void fetchLibrarySpaces().then((l) => !cancelled && setLibrary(l))
    void fetchCollectionAllowance().then((a) => !cancelled && setAllowance(a))
    return () => {
      cancelled = true
    }
  }, [approved, started])

  const candidates = useMemo(() => {
    if (!library) return []
    // Owning "X 2" is owning X — compare on the subject, number stripped.
    const have = new Set([...owned, ...building].flatMap((s) => [keyOf(s), keyOf(baseOf(s))]))
    const inLibrary = new Set(library.map((s) => s.key))
    return library.filter((s) => {
      if (s.topicCount < MIN_TOPICS) return false
      if (have.has(s.key) || have.has(keyOf(baseOf(s.name)))) return false
      // A numbered copy of a subject the library already holds is a
      // duplicate that leaked in from someone's renamed folder ("System
      // Architecture for PMs 2"). The server no longer lets new ones in;
      // this keeps the ones already there from being suggested.
      if (baseOf(s.name) !== s.name && inLibrary.has(keyOf(baseOf(s.name)))) return false
      return true
    })
  }, [library, owned, building])

  // Pick once the list arrives, and again only if the current pick stops
  // being a candidate (it was just added). Not on every render: a suggestion
  // that changed under the reader's eyes would be a slot machine.
  useEffect(() => {
    if (current && candidates.some((c) => c.key === current.key)) return
    const next = pickRandom(candidates, lastShown)
    setCurrent(next)
    if (next) lastShown = next.key
  }, [candidates, current])

  if (!approved) return null

  const another = () => {
    const next = pickRandom(candidates, current?.key ?? null)
    setCurrent(next)
    if (next) lastShown = next.key
  }

  const start = async () => {
    if (!current || busy) return
    setBusy(true)
    setError(null)
    try {
      // The exact library name: the server's library lookup is a match on
      // this, so it copies rather than generates.
      await startOnboarding(current.name)
      setStarted(current.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="launcher suggestion">
      <div className="launcher-title">Start an existing collection</div>

      {started ? (
        <div className="launcher-started">
          <Sparkles width={15} height={15} />
          <span>
            Adding <strong>{started}</strong> — it'll appear above in a moment.
          </span>
          <button className="ob-linklike inline" onClick={() => setStarted(null)}>
            Suggest another
          </button>
        </div>
      ) : allowance?.blocked ? (
        <p className="launcher-hint">{allowance.blocked}</p>
      ) : library === null ? (
        <p className="launcher-hint">Looking through the library…</p>
      ) : !current ? (
        <p className="launcher-hint">
          You already have every collection in the library. Start a brand new one below.
        </p>
      ) : (
        <>
          <p className="launcher-hint">
            Already written by someone else — yours in seconds, with no waiting for it to be
            drafted.
          </p>
          <div className="suggestion-card">
            <div className="suggestion-name">{current.name}</div>
            <div className="suggestion-meta">
              {current.topicCount} topics
              {current.sampleTopics.length > 0 && <> · {current.sampleTopics.join(', ')}…</>}
            </div>
            <div className="suggestion-actions">
              <button className="ob-btn primary" onClick={() => void start()} disabled={busy}>
                {busy ? <span className="spinner" /> : <ArrowRight />} {busy ? 'Adding…' : 'Start this collection'}
              </button>
              {candidates.length > 1 && (
                <button className="ob-btn" onClick={another} disabled={busy}>
                  <RotateCw width={14} height={14} /> Show another
                </button>
              )}
            </div>
          </div>
          {error && <div className="ob-error launcher-error">{error}</div>}
        </>
      )}
    </div>
  )
}
