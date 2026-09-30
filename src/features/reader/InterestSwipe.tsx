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
// physics are what sell that it is a card:
//
//   - It follows the finger in both axes, not just sideways, because a card
//     on a table does.
//   - It pivots around where you grabbed it: take it by the top and it tilts
//     one way, by the bottom and it tilts the other.
//   - It is thrown, not dismissed: it leaves along the direction and at the
//     speed it was released, so a lazy push drifts off and a flick snaps away.
//   - A drag that does not commit springs back past centre and settles, the
//     way something with weight does.
//   - Crossing the line where letting go would count gives a tick on devices
//     that can vibrate, so the commit point can be felt, not just seen.
//
// The buttons and the arrow keys are not a fallback for the gesture — they
// are the same two answers for anyone who would rather not drag at all,
// including assistive tech, which cannot perform a swipe. They throw the card
// too, so every way in looks the same.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from '../../ui/icons'
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

/** How far the card must travel to count, as a share of its width. Far
 *  enough that a wobble while lifting a thumb is not an answer. */
const COMMIT_SHARE = 0.32
/** A fast flick commits under the distance threshold, as every card-swipe
 *  interface people already know behaves. px per ms. */
const FLICK_VELOCITY = 0.6
const FLICK_MIN_PX = 34
/** Degrees of tilt at the commit distance. */
const MAX_TILT = 14
/** Vertical follow is damped: the card is being slid off sideways, and a
 *  one-to-one vertical follow makes it feel carried rather than pushed. */
const Y_DAMP = 0.45
/** The throw's duration is distance over speed, held inside these bounds —
 *  a very slow release still has to leave, a very fast one still has to be
 *  seen leaving. */
const THROW_MIN_MS = 170
const THROW_MAX_MS = 420
/** Speed a button press throws at, px per ms. A brisk hand, not a flick. */
const BUTTON_THROW_SPEED = 1.8
/** How long the uncovered card is shown, fully in place, before the answer
 *  is sent and the reader is moved on. Long enough to read its title, which
 *  is the point of uncovering it. */
const REVEAL_HOLD_MS = 380

type Direction = 'left' | 'right'
interface Pos {
  x: number
  y: number
}
interface Throw {
  dir: Direction
  x: number
  y: number
  rot: number
  ms: number
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function vibrate(ms: number): void {
  // Not in Safari, and a no-op on desktops. A nicety either way.
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* some embedded browsers throw instead of ignoring it */
  }
}

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
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [thrown, setThrown] = useState<Throw | null>(null)
  // +1 when grabbed above the middle, -1 below: which way the card pivots.
  const [pivot, setPivot] = useState(1)
  const cardRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    id: number
    x0: number
    y0: number
    // The last two samples, for release velocity. A whole-gesture average
    // would read a drag that paused and then flicked as slow.
    samples: { x: number; y: number; t: number }[]
    armed: boolean
  } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const locked = busy || thrown !== null
  const widthOf = () => cardRef.current?.offsetWidth ?? 320

  /** Every way of answering ends here: send the card off along a vector, let
   *  the next one settle, then report the answer. */
  const throwCard = (dir: Direction, vx: number, vy: number) => {
    if (locked) return
    drag.current = null
    setDragging(false)
    if (reducedMotion()) {
      onChoose(dir === 'right')
      return
    }
    const w = widthOf()
    const sign = dir === 'right' ? 1 : -1
    // Far enough that the card is fully off the panel at any tilt.
    const outX = sign * (window.innerWidth * 0.6 + w)
    const speed = Math.max(Math.hypot(vx, vy), 0.9)
    const ms = Math.round(Math.min(THROW_MAX_MS, Math.max(THROW_MIN_MS, Math.abs(outX - pos.x) / speed)))
    // Keep the vertical momentum it was released with, so a card flicked up
    // and to the right leaves up and to the right.
    const outY = pos.y + vy * ms * 0.6
    setThrown({ dir, x: outX, y: outY, rot: sign * MAX_TILT * 2 * pivot, ms })
    vibrate(12)
    timers.current.push(setTimeout(() => onChoose(dir === 'right'), ms + REVEAL_HOLD_MS))
  }

  // A failed save brings the card back from wherever it was thrown, so the
  // answer can be given again. It springs back in along its own path.
  useEffect(() => {
    if (!error) return
    setThrown(null)
    setPos({ x: 0, y: 0 })
  }, [error])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
      else if (e.key === 'ArrowLeft') throwCard('left', -BUTTON_THROW_SPEED, -0.15)
      else if (e.key === 'ArrowRight') throwCard('right', BUTTON_THROW_SPEED, -0.15)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // throwCard closes over `locked`, `pos` and `pivot`; re-binding keeps a
    // key press from throwing a card that is already on its way out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, locked, pos, pivot, onCancel])

  useEffect(() => {
    panelRef.current?.focus()
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || (e.pointerType === 'mouse' && e.button !== 0)) return
    // Captured, so a drag that leaves the card — which a fast one always
    // does — keeps reporting to it instead of stranding it mid-tilt.
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    setPivot(e.clientY < rect.top + rect.height / 2 ? 1 : -1)
    const t = performance.now()
    drag.current = {
      id: e.pointerId,
      // Relative to where the card already is, so catching it mid-spring
      // does not snap it to the finger.
      x0: e.clientX - pos.x,
      y0: e.clientY - pos.y / Y_DAMP,
      samples: [{ x: e.clientX, y: e.clientY, t }],
      armed: false,
    }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const x = e.clientX - d.x0
    setPos({ x, y: (e.clientY - d.y0) * Y_DAMP })
    d.samples = [...d.samples.slice(-1), { x: e.clientX, y: e.clientY, t: performance.now() }]
    const armed = Math.abs(x) >= widthOf() * COMMIT_SHARE
    if (armed !== d.armed) {
      d.armed = armed
      if (armed) vibrate(8) // felt at the moment letting go starts to count
    }
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setDragging(false)
    const a = d.samples[0]
    const b = d.samples[d.samples.length - 1]
    const dt = Math.max(1, b.t - a.t)
    // Stale samples are not a velocity: a finger held still and then lifted
    // has none, whatever it was doing before it stopped.
    const idle = performance.now() - b.t > 80
    const vx = idle ? 0 : (b.x - a.x) / dt
    const vy = idle ? 0 : ((b.y - a.y) / dt) * Y_DAMP
    const far = Math.abs(pos.x) >= widthOf() * COMMIT_SHARE
    const flick = Math.abs(vx) >= FLICK_VELOCITY && Math.abs(pos.x) >= FLICK_MIN_PX
    // A cancelled pointer (the OS took the gesture) is never an answer. A
    // flick decides by its own direction, so a card dragged right and then
    // flicked back left goes left — the hand's last word counts.
    if (e.type !== 'pointercancel' && (far || flick)) {
      const dir: Direction = flick ? (vx > 0 ? 'right' : 'left') : pos.x > 0 ? 'right' : 'left'
      throwCard(dir, vx, vy)
    } else {
      setPos({ x: 0, y: 0 }) // spring back, with overshoot — see the CSS
    }
  }

  const w = widthOf()
  // -1..1, how committed the card currently looks. Drives the stamps and the
  // rise of the card beneath, so the answer is visible before letting go.
  const lean = thrown
    ? thrown.dir === 'right' ? 1 : -1
    : Math.max(-1, Math.min(1, pos.x / (w * COMMIT_SHARE)))
  const reveal = thrown ? 1 : Math.abs(lean)

  const topStyle = {
    '--x': `${thrown ? thrown.x : pos.x}px`,
    '--y': `${thrown ? thrown.y : pos.y}px`,
    '--rot': `${thrown ? thrown.rot : lean * MAX_TILT * 0.6 * pivot}deg`,
    '--throw-ms': `${thrown?.ms ?? 0}ms`,
    // Pivot around where it was held: grabbing low swings the top.
    transformOrigin: pivot > 0 ? '50% 120%' : '50% -20%',
  } as CSSProperties

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
          style={{ '--reveal': reveal } as CSSProperties}
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
            style={topStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
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
          <button className="sw-btn sw-no" onClick={() => throwCard('left', -BUTTON_THROW_SPEED, -0.15)} disabled={locked}>
            <X width={16} height={16} /> Not for me
          </button>
          <button className="sw-btn sw-yes" onClick={() => throwCard('right', BUTTON_THROW_SPEED, -0.15)} disabled={locked}>
            {busy ? <span className="spinner" /> : <Check width={16} height={16} />} More like this
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
