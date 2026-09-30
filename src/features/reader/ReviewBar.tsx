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
// **Both are this one component**, and neither holds the finishing state.
// That lives in useFinishNote, created once by NoteView and passed in here,
// because on a phone the note itself can also be thrown to finish it — so
// there are three ways in, and they all have to agree on whether the note is
// done, whether a save is in flight and what went wrong.
//
// Finishing asks one thing, interest, and how it asks depends on the device:
// on touch, a card you swipe away — right for more like this, left for not
// for me; on a desktop, the form, one row of 1-5. A thumb is built for a
// swipe and a mouse is not, so neither device gets the other's control.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, RefObject } from 'react'
import type { Note } from '../../vault/types'
import { Check, RotateCw } from '../../ui/icons'
import { useScrollReview } from './useScrollReview'
import { InterestSwipe } from './InterestSwipe'
import { ReviewDialog, type ReviewScores } from './ReviewDialog'
import { INTERESTED, MAX_CONFIDENCE, NOT_INTERESTED, currentConfidence, type NoteFinisher } from './useFinishNote'
import './score.css'

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
  finisher,
  touch,
}: {
  note: Note
  /** The note's scroll container. The sheet is portalled into it so it can
   *  stick to the foot of the reader from anywhere in the document — this
   *  component is rendered in the middle of the note, and a sticky element
   *  can only stick inside its own scroller. */
  scrollRef: RefObject<HTMLElement | null>
  /** The note's one finishing state, shared with the note swipe. */
  finisher: NoteFinisher
  touch: boolean
}) {
  const { tracked, writable, reviewedToday, busy, done, error, next } = finisher
  // Neither control writes anything by itself: both open the card, or the
  // form on a desktop.
  const [asking, setAsking] = useState(false)

  // A ref is not enough to portal into: it holds no value on the first
  // render and changing it does not schedule one. State does.
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(() => setScroller(scrollRef.current), [scrollRef, note.path])

  const conf = currentConfidence(note.frontmatter)

  // Held in a ref so the gesture's onComplete — attached once, outside
  // React's render cycle — never calls a stale copy of the write.
  const runRef = useRef<() => void>(() => {})

  /** The button and the gesture both land here: ask, do not assume. */
  const ask = () => {
    if (asking || !finisher.canFinish) return
    finisher.clearError()
    setAsking(true)
  }

  const submit = async (interest: number) => {
    if (await finisher.finish(interest, { swiped: touch })) setAsking(false)
  }
  runRef.current = () => ask()

  const active = finisher.canFinish && !asking
  // Disabled outright on a pointer device: there, the button is the whole
  // interaction and a wheel at the end of a note should just be a wheel.
  const { progress, armed } = useScrollReview(scrollRef, {
    enabled: active && touch,
    onComplete: () => runRef.current(),
  })

  // A new note starts its own gesture from zero.
  useEffect(() => setAsking(false), [note.path])

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
            finisher.clearError()
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
            finisher.clearError()
          }}
        />
      )}
    </div>
  )
}
