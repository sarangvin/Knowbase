// Marking a note reviewed. Two ways in on touch, one write.
//
// A topic note is AI Notes, then Useful Links, then My Notes, then
// Questions — and the last two are optional exercises. So there are two
// places a reader can finish:
//
//   Under AI Notes — a "Mark reviewed" button, where the reading ends.
//   Everywhere, because it is the only control a pointer gets and the one
//   that makes finishing cheap: no scrolling past a question list to say
//   you read the prose.
//
//   At the foot of the scroller — an orange sheet that rises as you swipe
//   up past the end of the note, on touch only. Someone who does work
//   through the questions arrives here, and sending them back up the note
//   to a button they have already scrolled past is its own toll. A pointer
//   does not get this: pushing a wheel against a threshold is a gesture
//   borrowed from a device that is not there, and the sheet is the wrong
//   shape for a wheel's discrete clicks.
//
// **Both are this one component.** The sheet is portalled into the
// scroller rather than mounted separately, so there is a single `asking`
// flag, a single swipe card and a single submit.
//
// Either way in, finishing is the same two writes:
//   - confidence +1, because a review is one of the four things that earn it
//     (see backend/src/vault/confidence.ts for the other three);
//   - interest, which is what steers which topics get written next. How it
//     is asked depends on the device: on touch, a card you swipe away —
//     right for more like this (5), left for not for me (1); on a desktop,
//     the form it replaced there, one row of 1-5. A thumb is built for a
//     swipe and a mouse is not, so neither device gets the other's control. Two components each holding
// their own copy of that state is how one control ends up reporting
// "Review complete" while the other still offers to review — the same
// drift this codebase has paid for elsewhere.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, RefObject } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { computeNextUp, configOf, isReviewedToday, localDay, spaceOfPath } from '../automated-graph/engine'
import { Check, RotateCw } from '../../ui/icons'
import { useScrollReview } from './useScrollReview'
import { InterestSwipe, type NextCard } from './InterestSwipe'
import { ReviewDialog, type ReviewScores } from './ReviewDialog'
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
 *  `pointer: coarse` too, and it should not grow a swipe sheet, so the
 *  absence of hover is the half of the test that actually decides. */
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

/** What a swipe writes. The ends of the scale, not a nudge: a ±1 step from
 *  the model's opening guess would let "I want more of this" land on a
 *  neutral 3, and the grower reads 4+ and 2- as the reader's votes. The
 *  desktop form writes whatever 1-5 was picked. */
const INTERESTED = 5
const NOT_INTERESTED = 1

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

export function ReviewBar({
  note,
  scrollRef,
}: {
  note: Note
  /** The note's scroll container. The sheet is portalled into it so it can
   *  stick to the foot of the reader from anywhere in the document — this
   *  component is rendered in the middle of the note, and a sticky element
   *  can only stick inside its own scroller. */
  scrollRef: RefObject<HTMLElement | null>
}) {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const openNote = useVault((s) => s.openNote)
  const source = useVault((s) => s.source)
  const index = useVault((s) => s.index)
  const touch = useTouchPrimary()

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Neither control writes anything by itself: both open the swipe card.
  const [asking, setAsking] = useState(false)

  // A ref is not enough to portal into: it holds no value on the first
  // render and changing it does not schedule one. State does.
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(() => setScroller(scrollRef.current), [scrollRef, note.path])

  // Only on notes that actually take part in the review loop. A note with no
  // confidence and no last_reviewed is prose, not a topic, and a review
  // control there would write frontmatter nobody asked for.
  const tracked = 'confidence' in note.frontmatter || 'last_reviewed' in note.frontmatter
  const writable = !!source?.writable && (source.isPathWritable?.(note.path) ?? true)
  // Reviewing earns one step. Not asked for — confidence is what you have
  // done with a note, not how you feel about it.
  const conf = currentConfidence(note.frontmatter)
  // One review per note per day. A second pass on the same day is not a
  // second review — spacing is the whole mechanism, and letting confidence
  // be walked up to 5 in one sitting would make the ranking describe an
  // afternoon's enthusiasm rather than what has actually stuck.
  const reviewedToday = isReviewedToday(note.frontmatter)
  // The threshold at which a topic counts as learned. Read from the space's
  // _config so the reader and the Next Up ranking agree on what "known"
  // means rather than each holding its own idea of it.
  const space = spaceOfPath(note.path)

  // The card underneath the one being swiped away: what Next Up would pick
  // once this note is done. The same ranking, not a guess at it, so the card
  // that is revealed is the note you are then taken to — the stack is a
  // literal picture of where finishing sends you. This note is excluded
  // because it is about to stop being new; anything already reviewed today
  // is excluded because the reader will refuse to review it again.
  // Touch only — the desktop form has no deck to reveal — and only while it
  // is open, because it walks the whole space.
  const next = useMemo<NextCard | null>(() => {
    if (!asking || !touch || !index || !space) return null
    const r = computeNextUp(index, space)
    const fresh = r.ranked.find((t) => t.path !== note.path)
    if (fresh) return { path: fresh.path, title: fresh.title, kind: 'new', pending: fresh.pending }
    const again = r.review.find((t) => t.path !== note.path && t.lastReviewed !== localDay())
    return again ? { path: again.path, title: again.title, kind: 'review', pending: again.pending } : null
  }, [asking, touch, index, space, note.path])
  const threshold = index && space ? configOf(index, space).confidence_threshold : 3

  // Held in a ref so the gesture's onComplete — attached once, outside
  // React's render cycle — never calls a stale copy of the write.
  const runRef = useRef<() => void>(() => {})
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** The button and the gesture both land here: ask, do not assume. */
  const ask = () => {
    if (busy || done || asking || !writable || !tracked || reviewedToday) return
    setError(null)
    setAsking(true)
  }

  const submit = async (interest: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Re-read rather than trusting the rendered copy: a background draft
      // may have rewritten the body since this note was displayed, and a
      // quiz answer or a flashcard may have moved its confidence.
      const current = getNote(note.path)
      if (!current) throw new Error('note not found')
      const confidence = Math.min(MAX_CONFIDENCE, currentConfidence(current.frontmatter) + 1)
      let raw = setFrontmatterValue(current.raw, 'last_reviewed', localDay())
      raw = setFrontmatterValue(raw, 'confidence', confidence)
      raw = setFrontmatterValue(raw, 'interest', interest)
      // Status follows confidence. A review only ever adds, so this can only
      // flip a note up to "known" — but written as both directions anyway,
      // because a wrong quiz answer can have taken it down since the note
      // was last saved, and the two paths should agree on the rule.
      const status = current.frontmatter.status
      if (confidence >= threshold && status === 'frontier') {
        raw = setFrontmatterValue(raw, 'status', 'known')
      } else if (confidence < threshold && status === 'known') {
        raw = setFrontmatterValue(raw, 'status', 'frontier')
      }
      if (raw !== current.raw) await saveNote(note.path, raw)
      // Finishing a topic is exactly when the tree should grow: the server
      // tops it back up, using what they now know as the prerequisites and
      // what they just swiped as the steer. Not awaited, and its failure
      // cannot surface here — the review is already saved.
      if (space) requestSpaceGrowth(space)
      setAsking(false)
      // Onto the card they just uncovered. Next Up's own top pick, so this
      // is the page's decision, just without making them go and read it;
      // with nothing left to uncover, back to Next Up, where the empty state
      // explains why. Leaving them in the finished note with nothing to do
      // would make them find their own way out.
      // Only after a swipe: there the next card was on screen, so landing on
      // it is keeping a promise. The desktop form showed no such card, and
      // goes back to Next Up as it always did.
      if (touch && next) openNote(next.path)
      else if (space) openNote(`Automated Graph/${space}/Next Up.md`)
      else setDone(true)
      holdRef.current = setTimeout(() => setDone(false), (touch ? OPEN_MS : 0) + HOLD_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  runRef.current = () => ask()

  const active = tracked && writable && !busy && !done && !asking && !reviewedToday
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
    setAsking(false)
    if (holdRef.current) clearTimeout(holdRef.current)
  }, [note.path])

  useEffect(() => () => void (holdRef.current && clearTimeout(holdRef.current)), [])

  if (!tracked) return null
  // Already done today: no control at all, rather than a disabled one
  // explaining why. `done` keeps it on screen for the hold that follows a
  // review just made — the write puts today's date in the frontmatter, so
  // without this both controls would vanish mid-"Review complete".
  if (reviewedToday && !done) return null

  const detail =
    conf >= MAX_CONFIDENCE
      ? 'Records today’s review, then asks how much you want more like this.'
      : 'Adds one to confidence, then asks how much you want more like this.'

  const rawInterest = Number(note.frontmatter.interest)
  const initialInterest = Number.isFinite(rawInterest) ? Math.min(5, Math.max(1, Math.round(rawInterest))) : 3

  // ── The sheet, at the foot of the scroller, touch only ───────────────────
  // One number drives height, ring and glyph size. Held at full while the
  // finished state is up, so the sheet locks instead of deflating.
  const p = done ? 1 : progress
  const pulling = p > 0.02
  // Nothing to swipe anywhere but the end of the note, so the sheet is not
  // there anywhere else — it would just be a bar covering the text with an
  // instruction you cannot follow yet.
  const visible = armed || pulling || done || asking || !!error

  let sheetLabel: string
  if (error && !asking) sheetLabel = error
  else if (done) sheetLabel = 'Review complete'
  else if (!writable) sheetLabel = 'This vault is read-only'
  else sheetLabel = 'Swipe up to complete'

  const sheet = (
    <div className="reviewsheet-slot">
      <button
        type="button"
        className={
          'reviewsheet' +
          (visible ? ' is-visible' : '') +
          (pulling ? ' is-pulling' : '') +
          (done ? ' is-done' : '') +
          (error && !asking ? ' is-error' : '') +
          (writable ? '' : ' is-locked')
        }
        style={{ '--p': p } as CSSProperties}
        disabled={!writable || busy || done || !visible}
        onClick={ask}
        // The gesture is the discoverable path; assistive tech gets the plain
        // one, described by what it will actually write. The name starts
        // with the visible word so voice control ("tap complete") can reach
        // a control whose visible label is otherwise an instruction.
        aria-label={`Complete. ${detail}`}
        aria-hidden={!visible}
        title={writable ? detail : 'This vault is read-only.'}
      >
        <Dial progress={progress} done={done} />
        <span className="rs-label">{sheetLabel}</span>
      </button>
    </div>
  )

  return (
    <div className="review-actions">
      <button
        className={'review-btn' + (done ? ' is-done' : '')}
        disabled={!writable || busy || done}
        onClick={ask}
        title={writable ? detail : 'This vault is read-only.'}
      >
        {done ? <Check width={15} height={15} /> : <RotateCw width={15} height={15} />}
        {done ? 'Review complete' : busy ? 'Saving…' : 'Mark reviewed'}
      </button>
      <span className={'review-hint' + (error && !asking ? ' is-error' : '')}>
        {(!asking && error) || (writable ? detail : 'This vault is read-only.')}
      </span>
      {touch && scroller && createPortal(sheet, scroller)}
      {asking && !touch && (
        <ReviewDialog
          title={note.title}
          // Pre-filled with what the note already says, so submitting without
          // touching the row keeps its value rather than resetting it.
          initial={{ interest: initialInterest }}
          busy={busy}
          error={error}
          onSubmit={(sc: ReviewScores) => void submit(sc.interest)}
          onCancel={() => {
            if (busy) return
            setAsking(false)
            setError(null)
          }}
        />
      )}
      {asking && touch && (
        <InterestSwipe
          title={note.title}
          next={next}
          busy={busy}
          error={error}
          onChoose={(interested) => void submit(interested ? INTERESTED : NOT_INTERESTED)}
          onCancel={() => {
            if (busy) return
            setAsking(false)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
