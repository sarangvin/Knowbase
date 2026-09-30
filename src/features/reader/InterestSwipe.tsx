// What finishing a note asks: do you want more like this?
//
// This replaced a three-question form — confidence, importance and interest,
// each a row of five numbers. Two of those answers were not really the
// reader's to give. Confidence is now earned rather than declared (+1 per
// review, per flashcard, per right quiz answer, -1 per wrong one), and
// importance was dropped outright. What is left is the one thing only the
// reader knows, and it is a yes or a no, so it gets a gesture instead of a
// form: swipe right for more like this, left for not for me.
//
// That answer is written as `interest: 5` or `interest: 1` and it is what
// steers generation — see interestSignals in backend/src/onboarding/grow.ts.
//
// **It is a stack, not a dialog.** The note is the top card. Under it is the
// next topic — the one Next Up would pick, and the one you are taken to — and
// under that a third card for depth. Dragging the top card uncovers the next
// one, which rises and grows into place in step with how far you have
// pulled; throwing it away leaves the next card sitting where it was. The
// physics — follow in both axes, pivot where held, thrown at release speed,
// springy return, a vibration tick at the commit line — are in
// useCardThrow.ts, shared with the note itself, which on a phone can be
// thrown the same way without opening this card at all.
//
// The buttons and the arrow keys are not a fallback for the gesture — they
// are the same two answers for anyone who would rather not drag at all,
// including assistive tech, which cannot perform a swipe. They throw the card
// too, so every way in looks the same.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from '../../ui/icons'
import { useCardThrow } from './useCardThrow'
import './interestSwipe.css'

/** The card beneath: what finishing this note hands you next. */
export interface NextCard {
  path: string
  title: string
  /** 'new' is an unopened topic; 'review' is the fallback when nothing new is
   *  ready, which the card has to say or it would present an old note as new. */
  kind: 'new' | 'review'
  pending: boolean
}

/** Speed a button press or arrow key throws at, px per ms: a brisk hand,
 *  not a flick. */
const BUTTON_THROW_SPEED = 1.8

export function InterestSwipe({
  title,
  next,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  title: string
  next: NextCard | null
  busy: boolean
  error: string | null
  /** true = thrown right, wants more like this. */
  onChoose: (interested: boolean) => void
  onCancel: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The same physics the note itself is thrown with — see useCardThrow.
  const card = useCardThrow({
    enabled: !busy,
    widthOf: () => cardRef.current?.offsetWidth ?? 320,
    yDamp: 0.45,
    maxTilt: 14,
    capture: true,
    onThrown: (dir) => onChoose(dir === 'right'),
  })
  const { thrown, dragging, lean, vars, throwCard, reset } = card
  const locked = busy || thrown !== null

  // A failed save brings the card back from wherever it was thrown, so the
  // answer can be given again. It springs back in along its own path.
  useEffect(() => {
    if (error) reset()
  }, [error, reset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
      else if (locked) return
      else if (e.key === 'ArrowLeft') throwCard('left', -BUTTON_THROW_SPEED, -0.15)
      else if (e.key === 'ArrowRight') throwCard('right', BUTTON_THROW_SPEED, -0.15)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, locked, onCancel, throwCard])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return createPortal(
    // Portalled to <body>: the swipe-up sheet that opens this sits in a
    // sticky, z-indexed container, and an overlay inside that stacking
    // context cannot rise above it.
    <div className="sw-overlay" onClick={() => !locked && onCancel()}>
      <div
        className="sw-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sw-title"
        aria-describedby="sw-question"
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sw-head">
          <div>
            <div className="sw-eyebrow">Finished · confidence +1</div>
            <p className="sw-question" id="sw-question">Want more like this?</p>
          </div>
          <button className="sw-close" onClick={onCancel} disabled={locked} aria-label="Cancel">
            <X width={16} height={16} />
          </button>
        </div>

        <div
          className={'sw-stack' + (dragging ? ' sw-dragging' : '') + (thrown ? ' sw-thrown' : '')}
          style={vars}
        >
          {/* Depth only: the rest of the deck. */}
          <div className="sw-card sw-card-deep" aria-hidden="true" />

          {/* What finishing this note hands you. Real content, because the
              point of uncovering it is to see where you are going. */}
          <div className="sw-card sw-card-next" aria-hidden={!thrown}>
            <div className="sw-card-eyebrow">
              {next?.kind === 'review' ? 'Up next · review' : 'Up next'}
            </div>
            <div className="sw-next-title">{next ? next.title : 'You’re caught up'}</div>
            <div className="sw-card-hint">
              {!next
                ? 'New topics are written as you finish these'
                : next.pending
                  ? 'Still being written — it will be ready shortly'
                  : 'Opens when this one goes'}
            </div>
          </div>

          <div
            ref={cardRef}
            className={'sw-card sw-card-top' + (lean > 0.05 ? ' sw-leans-right' : lean < -0.05 ? ' sw-leans-left' : '')}
            {...card.handlers}
          >
            {/* Stamped on the card, on the side it is moving away from, so
                the word stays readable the whole way out. */}
            <span className="sw-stamp sw-stamp-yes" aria-hidden="true" style={{ opacity: Math.max(0, lean) }}>
              More like this
            </span>
            <span className="sw-stamp sw-stamp-no" aria-hidden="true" style={{ opacity: Math.max(0, -lean) }}>
              Not for me
            </span>
            <div className="sw-card-eyebrow">This note</div>
            <h2 className="sw-title" id="sw-title">{title}</h2>
            <p className="sw-card-hint">{busy ? 'Saving…' : 'Swipe right for more like this, left if not'}</p>
          </div>
        </div>

        {error && <div className="sw-error" role="alert">{error}</div>}

        <div className="sw-foot">
          <button className="sw-btn sw-no" onClick={() => !locked && throwCard('left', -BUTTON_THROW_SPEED, -0.15)} disabled={locked}>
            <X width={16} height={16} /> Not for me
          </button>
          <button className="sw-btn sw-yes" onClick={() => !locked && throwCard('right', BUTTON_THROW_SPEED, -0.15)} disabled={locked}>
            {busy ? <span className="spinner" /> : <Check width={16} height={16} />} More like this
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
