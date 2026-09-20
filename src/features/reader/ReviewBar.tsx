// The review tab — a strip pinned to the foot of the reader that fills as
// you keep scrolling past the end of the note, and marks it reviewed when
// it's full.
//
// This replaces a "Mark reviewed" button sitting at the bottom of the note.
// The button worked, but it asked for a second, unrelated action after
// reading: find it, aim, click. The gesture folds the action into the
// reading itself — you finish the note, keep going, and that *is* the
// signal. It also states the whole loop up front: the tab is visible from
// the first paragraph, so "scroll down to review" is read before it's
// needed rather than discovered at the end.
//
// The tab is still a real button. Pressing it does the same write. That is
// not a fallback bolted on for compliance — keyboard and screen-reader users
// have no overscroll to give, and a gesture with no equivalent control is
// simply an action they cannot perform.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { spaceOfPath } from '../automated-graph/engine'
import { Check, ChevronsDown } from '../../ui/icons'
import { useScrollReview } from './useScrollReview'
import './score.css'

const MAX_CONFIDENCE = 5

/** Local date, not toISOString(). The vault stores plain YYYY-MM-DD and
 *  toISOString() is UTC, so anyone east of Greenwich reviewing in the evening
 *  would stamp tomorrow's date. */
function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function currentConfidence(fm: Record<string, unknown>): number {
  const raw = fm.confidence
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  return Number.isFinite(n) ? Math.min(MAX_CONFIDENCE, Math.max(0, Math.round(n))) : 0
}

export function ReviewBar({ note, scrollRef }: { note: Note; scrollRef: RefObject<HTMLElement | null> }) {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const source = useVault((s) => s.source)

  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only on notes that actually take part in the review loop. A note with no
  // confidence and no last_reviewed is prose, not a topic, and a review
  // control there would write frontmatter nobody asked for.
  const tracked = 'confidence' in note.frontmatter || 'last_reviewed' in note.frontmatter
  const writable = !!source?.writable && (source.isPathWritable?.(note.path) ?? true)
  const conf = currentConfidence(note.frontmatter)
  const next = Math.min(MAX_CONFIDENCE, conf + 1)
  const atMax = conf >= MAX_CONFIDENCE

  // Held in a ref so the gesture's onComplete — attached once, outside
  // React's render cycle — never calls a stale copy of the write.
  const runRef = useRef<() => void>(() => {})

  const run = async () => {
    if (busy || !writable || !tracked) return
    setBusy(true)
    setError(null)
    try {
      // Re-read rather than trusting the rendered copy: a background draft
      // may have rewritten the body since this note was displayed.
      const current = getNote(note.path)
      if (!current) throw new Error('note not found')
      let raw = setFrontmatterValue(current.raw, 'last_reviewed', today())
      // At 5 there is nothing to raise, but the review still happened — the
      // date is what moves it out of "due for review".
      if (!atMax) raw = setFrontmatterValue(raw, 'confidence', next)
      // Unchanged means already reviewed today at max confidence — the state
      // the gesture was asking for. Treating that as an error blames the user
      // for the system already being right.
      if (raw !== current.raw) await saveNote(note.path, raw)
      setJustSaved(true)
      // Finishing a topic is exactly when the tree should grow: the server
      // tops it back up to three unstudied topics, using what they now know
      // as the prerequisites for what comes next. Not awaited, and its
      // failure cannot surface here — the review is already saved.
      const space = spaceOfPath(note.path)
      if (space) requestSpaceGrowth(space)
      setTimeout(() => setJustSaved(false), 2600)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  runRef.current = () => void run()

  const active = tracked && writable && !busy && !justSaved
  const { progress, armed } = useScrollReview(scrollRef, {
    enabled: active,
    onComplete: () => runRef.current(),
  })

  // A new note starts its own gesture from zero, and an error from the last
  // one is about a note you are no longer looking at.
  useEffect(() => setError(null), [note.path])

  if (!tracked) return null

  const pulling = progress > 0.02
  const detail = atMax
    ? `Sets last reviewed to today. Confidence stays at ${MAX_CONFIDENCE}/${MAX_CONFIDENCE}.`
    : `Sets last reviewed to today and raises confidence to ${next}/${MAX_CONFIDENCE}.`

  let label: string
  if (!writable) label = 'This vault is read-only'
  else if (justSaved) label = 'Marked reviewed'
  else if (busy) label = 'Saving…'
  else if (pulling) label = progress > 0.75 ? 'Almost — keep going' : 'Keep scrolling…'
  else if (armed) label = 'Keep scrolling to mark reviewed'
  else label = 'Scroll down to review'

  return (
    <div className="reviewbar-slot">
      {error && <div className="reviewbar-err">{error}</div>}
      <button
        type="button"
        className={
          'reviewbar' +
          (armed || pulling ? ' is-armed' : '') +
          (pulling ? ' is-pulling' : '') +
          (justSaved ? ' is-done' : '')
        }
        style={{ '--p': `${Math.round(progress * 100)}%` } as CSSProperties}
        disabled={!writable || busy || justSaved}
        onClick={() => void run()}
        // The gesture is the discoverable path; assistive tech gets the
        // plain one, described by what it will actually write.
        aria-label={`Mark reviewed. ${detail}`}
        title={writable ? detail : 'This vault is read-only.'}
      >
        <span className="reviewbar-fill" aria-hidden="true" />
        <span className="reviewbar-body">
          {justSaved ? <Check width={15} height={15} /> : <ChevronsDown width={15} height={15} />}
          <span className="reviewbar-label">{label}</span>
        </span>
      </button>
    </div>
  )
}
