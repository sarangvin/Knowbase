// The review sheet — an orange panel at the foot of the reader that grows
// as you swipe up past the end of the note, and marks it reviewed when the
// ring inside it closes.
//
// This replaces a "Mark reviewed" button. The button asked for a second,
// unrelated action after reading: find it, aim, click. The gesture folds the
// action into the reading — you reach the end of the note, keep pulling, and
// that is the signal.
//
// Growth is the feedback. A bar that gets taller under your thumb is the
// clearest possible statement that the thing you are doing is working and
// how much of it is left; the ring inside restates the same number for
// anyone reading rather than feeling. Both are driven by one value.
//
// The sheet is still a real button, and pressing it does the same write.
// That is not a fallback bolted on for compliance — keyboard and screen
// reader users have no swipe to give, and a gesture with no equivalent
// control is simply an action they cannot perform.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { spaceOfPath } from '../automated-graph/engine'
import { useScrollReview } from './useScrollReview'
import './score.css'

const MAX_CONFIDENCE = 5

/** How long the completed sheet stays *fully open* before it collapses. Long
 *  enough to read "Review complete", short enough that it never feels like a
 *  dialog waiting to be dismissed. */
const HOLD_MS = 1000

/** The sheet's open transition, matching the CSS. Added to the hold so the
 *  second is a second of the locked state, not a second that the opening
 *  animation spends most of. */
const OPEN_MS = 240

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

/** Ring plus glyph in one 36-unit box, so the whole thing scales with the
 *  sheet from a single CSS width — no second size to keep in step. */
function Dial({ progress, done }: { progress: number; done: boolean }) {
  const pct = Math.round((done ? 1 : progress) * 100)
  return (
    <svg className="rs-dial" viewBox="0 0 36 36" aria-hidden="true">
      <circle className="rs-track" cx="18" cy="18" r="15" />
      {/* pathLength normalises the circumference to 100, so the dash array is
          just the percentage — no 2πr arithmetic to drift out of sync. */}
      <circle className="rs-fill" cx="18" cy="18" r="15" pathLength={100} strokeDasharray={`${pct} 100`} />
      <path className="rs-glyph" d={done ? 'm11.5 18.5 4.4 4.4 9-9' : 'm12 20.5 6-6 6 6'} />
    </svg>
  )
}

export function ReviewBar({ note, scrollRef }: { note: Note; scrollRef: RefObject<HTMLElement | null> }) {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const source = useVault((s) => s.source)

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
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
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = async () => {
    if (busy || done || !writable || !tracked) return
    setBusy(true)
    setError(null)
    // Lock the sheet open the moment the ring closes, not when the write
    // returns: the gesture is finished, and letting the panel sag back while
    // the network settles would read as a failure.
    setDone(true)
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
      // Finishing a topic is exactly when the tree should grow: the server
      // tops it back up to three unstudied topics, using what they now know
      // as the prerequisites for what comes next. Not awaited, and its
      // failure cannot surface here — the review is already saved.
      const space = spaceOfPath(note.path)
      if (space) requestSpaceGrowth(space)
      holdRef.current = setTimeout(() => setDone(false), OPEN_MS + HOLD_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDone(false)
    } finally {
      setBusy(false)
    }
  }
  runRef.current = () => void run()

  const active = tracked && writable && !busy && !done
  const { progress, armed } = useScrollReview(scrollRef, {
    enabled: active,
    onComplete: () => runRef.current(),
  })

  // A new note starts its own gesture from zero, and an error from the last
  // one is about a note you are no longer looking at.
  useEffect(() => {
    setError(null)
    setDone(false)
    if (holdRef.current) clearTimeout(holdRef.current)
  }, [note.path])

  useEffect(() => () => void (holdRef.current && clearTimeout(holdRef.current)), [])

  if (!tracked) return null

  // One number drives height, ring and glyph size. Held at full while the
  // completed state is up, so the sheet locks instead of deflating.
  const p = done ? 1 : progress
  const pulling = p > 0.02

  const detail = atMax
    ? `Sets last reviewed to today. Confidence stays at ${MAX_CONFIDENCE}/${MAX_CONFIDENCE}.`
    : `Sets last reviewed to today and raises confidence to ${next}/${MAX_CONFIDENCE}.`

  let label: string
  if (error) label = error
  else if (done) label = 'Review complete'
  else if (!writable) label = 'This vault is read-only'
  else label = 'Swipe up to review'

  return (
    <div className="reviewsheet-slot">
      <button
        type="button"
        className={
          'reviewsheet' +
          (armed ? ' is-armed' : '') +
          (pulling ? ' is-pulling' : '') +
          (done ? ' is-done' : '') +
          (error ? ' is-error' : '') +
          (writable ? '' : ' is-locked')
        }
        style={{ '--p': p } as CSSProperties}
        disabled={!writable || busy || done}
        onClick={() => void run()}
        // The gesture is the discoverable path; assistive tech gets the plain
        // one, described by what it will actually write.
        aria-label={`Mark reviewed. ${detail}`}
        title={writable ? detail : 'This vault is read-only.'}
      >
        <Dial progress={progress} done={done} />
        <span className="rs-label">{label}</span>
      </button>
    </div>
  )
}
