// Marking a note reviewed, in the idiom of whatever you are holding.
//
// On a phone it is a swipe: an orange sheet at the very foot of the note
// that rises as you pull up past the end and locks when the ring inside it
// closes. Growth is the feedback — the panel rises under your thumb, so how
// far in you are and how much is left are the same fact, read without
// looking away from the note. It only exists at the bottom of the note,
// because that is the only place the gesture means anything.
//
// On a laptop it is a button at the end of the note. A pointer can aim, so
// making someone push a wheel against a threshold buys nothing; it is a
// gesture borrowed from a device that isn't there. The sheet is also the
// wrong shape for a mouse — it asks for a sustained push that a wheel emits
// in discrete clicks.
//
// Both write the same thing, through the same code path below.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { configOf, isReviewedToday, localDay, spaceOfPath } from '../automated-graph/engine'
import { Check, RotateCw } from '../../ui/icons'
import { useScrollReview } from './useScrollReview'
import './score.css'

const MAX_CONFIDENCE = 5

/** How long the finished state stays up before it reverts. Long enough to
 *  read "Review complete", short enough that it never feels like a dialog
 *  waiting to be dismissed. */
const HOLD_MS = 1000

/** The sheet's open transition, matching the CSS. Added to the hold on
 *  touch so the second is a second of the locked state, not a second the
 *  opening animation spends most of. A click has nothing to open. */
const OPEN_MS = 240

/** Touch-first devices only: a laptop with a touchscreen reports
 *  `pointer: coarse` too, and it should get the button, so the absence of
 *  hover is the half of the test that actually decides. */
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

function useTouchPrimary(): boolean {
  const [touch, setTouch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(TOUCH_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(TOUCH_QUERY)
    const sync = () => setTouch(mq.matches)
    sync() // the first paint may predate a device change
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return touch
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
  const index = useVault((s) => s.index)
  const touch = useTouchPrimary()

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
  // One review per note per day. A second pass on the same day is not a
  // second review — spacing is the whole mechanism, and letting confidence
  // be walked up to 5 in one sitting would make the ranking describe an
  // afternoon's enthusiasm rather than what has actually stuck.
  const reviewedToday = isReviewedToday(note.frontmatter)
  // The threshold at which a topic counts as learned. Read from the space's
  // _config so the reader and the Next Up ranking agree on what "known"
  // means rather than each holding its own idea of it.
  const space = spaceOfPath(note.path)
  const threshold = index && space ? configOf(index, space).confidence_threshold : 3

  // Held in a ref so the gesture's onComplete — attached once, outside
  // React's render cycle — never calls a stale copy of the write.
  const runRef = useRef<() => void>(() => {})
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = async () => {
    if (busy || done || !writable || !tracked || reviewedToday) return
    setBusy(true)
    setError(null)
    // Show the finished state the moment the gesture completes, not when the
    // write returns: the user's part is over, and letting the sheet sag back
    // while the network settles would read as a failure.
    setDone(true)
    try {
      // Re-read rather than trusting the rendered copy: a background draft
      // may have rewritten the body since this note was displayed.
      const current = getNote(note.path)
      if (!current) throw new Error('note not found')
      let raw = setFrontmatterValue(current.raw, 'last_reviewed', localDay())
      // At 5 there is nothing to raise, but the review still happened — the
      // date is what moves it out of "due for review".
      if (!atMax) raw = setFrontmatterValue(raw, 'confidence', next)
      // Reaching the threshold is what "learned" means, so say so in the
      // frontmatter too. The ranking now reads confidence directly, but
      // status is the field a reader sees and the one a vault exported to
      // Obsidian is sorted by — leaving it on "frontier" forever made the
      // note claim to be unlearned material it had finished.
      if ((atMax ? conf : next) >= threshold && note.frontmatter.status === 'frontier') {
        raw = setFrontmatterValue(raw, 'status', 'known')
      }
      // Unchanged means already reviewed today at max confidence — the state
      // the gesture was asking for. Treating that as an error blames the user
      // for the system already being right.
      if (raw !== current.raw) await saveNote(note.path, raw)
      // Finishing a topic is exactly when the tree should grow: the server
      // tops it back up to three unstudied topics, using what they now know
      // as the prerequisites for what comes next. Not awaited, and its
      // failure cannot surface here — the review is already saved.
      if (space) requestSpaceGrowth(space)
      holdRef.current = setTimeout(() => setDone(false), (touch ? OPEN_MS : 0) + HOLD_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDone(false)
    } finally {
      setBusy(false)
    }
  }
  runRef.current = () => void run()

  const active = tracked && writable && !busy && !done && !reviewedToday
  // Disabled outright on a pointer device: there, the button is the whole
  // interaction and a wheel at the end of a note should just be a wheel.
  const { progress, armed } = useScrollReview(scrollRef, {
    enabled: active && touch,
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
  // Already done today: no control at all, rather than a disabled one
  // explaining why. `done` keeps it on screen for the hold that follows a
  // review just made — the write puts today's date in the frontmatter, so
  // without this the sheet would vanish mid-"Review complete".
  if (reviewedToday && !done) return null

  const detail = atMax
    ? `Sets last reviewed to today. Confidence stays at ${MAX_CONFIDENCE}/${MAX_CONFIDENCE}.`
    : `Sets last reviewed to today and raises confidence to ${next}/${MAX_CONFIDENCE}.`

  // ── Pointer: a button at the end of the note ─────────────────────────────
  if (!touch) {
    return (
      <div className="review-actions">
        <button
          className={'review-btn' + (done ? ' is-done' : '')}
          disabled={!writable || busy || done}
          onClick={() => void run()}
          title={writable ? detail : 'This vault is read-only.'}
        >
          {done ? <Check width={15} height={15} /> : <RotateCw width={15} height={15} />}
          {done ? 'Review complete' : busy ? 'Saving…' : 'Mark reviewed'}
        </button>
        <span className={'review-hint' + (error ? ' is-error' : '')}>
          {error ?? (writable ? detail : 'This vault is read-only.')}
        </span>
      </div>
    )
  }

  // ── Touch: the swipe-up sheet ────────────────────────────────────────────
  // One number drives height, ring and glyph size. Held at full while the
  // finished state is up, so the sheet locks instead of deflating.
  const p = done ? 1 : progress
  const pulling = p > 0.02
  // Nothing to swipe anywhere but the end of the note, so the sheet is not
  // there anywhere else — it would just be a bar covering the text with an
  // instruction you cannot follow yet.
  const visible = armed || pulling || done || !!error

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
          (visible ? ' is-visible' : '') +
          (pulling ? ' is-pulling' : '') +
          (done ? ' is-done' : '') +
          (error ? ' is-error' : '') +
          (writable ? '' : ' is-locked')
        }
        style={{ '--p': p } as CSSProperties}
        disabled={!writable || busy || done || !visible}
        onClick={() => void run()}
        // The gesture is the discoverable path; assistive tech gets the plain
        // one, described by what it will actually write.
        aria-label={`Mark reviewed. ${detail}`}
        aria-hidden={!visible}
        title={writable ? detail : 'This vault is read-only.'}
      >
        <Dial progress={progress} done={done} />
        <span className="rs-label">{label}</span>
      </button>
    </div>
  )
}
