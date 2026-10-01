// The physics of throwing a card, shared by everything that can be thrown.
//
// Two things are: the finish card (InterestSwipe) and, on a phone, the note
// itself. They have to feel like the same object — a reader who has thrown
// one will expect the other to behave identically — so the numbers live
// here once rather than twice.
//
// What makes it read as a card rather than an animation:
//   - it follows the finger in both axes (vertical damped), not just sideways;
//   - it pivots around where it was grabbed — held high, it swings from the
//     bottom, held low, from the top;
//   - it is thrown along the direction and at the speed it was released, so a
//     lazy push drifts off and a flick snaps away;
//   - a drag that does not commit springs back past centre (the overshoot is
//     in the CSS curve);
//   - crossing the line where letting go would count gives a vibration tick.
//
// `axisLock` is for the note. A note scrolls, so a drag only belongs to us
// once it is clearly sideways; until then the browser has it (the note sets
// `touch-action: pan-y`, which is what hands vertical drags to the browser in
// the first place and sends a pointercancel if it takes one over).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

export type Direction = 'left' | 'right'

/** How far the card must travel to count, as a share of its width. Far
 *  enough that a wobble while lifting a thumb is not an answer. */
const COMMIT_SHARE = 0.32
/** A fast flick commits under the distance threshold, as every card-swipe
 *  interface people already know behaves. px per ms. */
const FLICK_VELOCITY = 0.6
const FLICK_MIN_PX = 34
/** The throw's duration is distance over speed, held inside these bounds. */
const THROW_MIN_MS = 170
const THROW_MAX_MS = 420
/** How long what was underneath is shown, fully in place, before the answer
 *  is reported. Long enough to read its title — the point of revealing it. */
const REVEAL_HOLD_MS = 380
/** Movement before a locked drag decides which way it is going: native
 *  scrolling uses about this much slop before committing to an axis. */
const LOCK_SLOP_PX = 10
/** Sideways has to clearly dominate. A diagonal belongs to the scroll —
 *  losing a sideways swipe costs a retry, stealing a scroll costs a review. */
const LOCK_RATIO = 1.3

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

export interface CardThrowOptions {
  /** False drops new gestures; one already thrown still lands. */
  enabled: boolean
  /** Width of the thing being thrown, for the commit distance. */
  widthOf: () => number
  /** Share of vertical finger movement the card follows. */
  yDamp: number
  /** Tilt in degrees at the commit distance. A small card can tilt a lot; a
   *  whole page tilting that much looks like it is falling over. */
  maxTilt: number
  /** Called once the throw has landed and what was underneath has been
   *  seen. The caller reports the answer here. */
  onThrown: (dir: Direction) => void
  /** Wait for a clearly sideways movement before taking the gesture. */
  axisLock?: boolean
  /** Capture the pointer explicitly. For a small card, whose drags always
   *  leave it; a touch already captures implicitly, which is all a page needs. */
  capture?: boolean
  /** Whether this press may start a throw at all. */
  accept?: (e: ReactPointerEvent<HTMLElement>) => boolean
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

export function useCardThrow(o: CardThrowOptions) {
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [thrown, setThrown] = useState<Throw | null>(null)
  // +1 when grabbed above the middle, -1 below: which way it pivots.
  const [pivot, setPivot] = useState(1)
  // One frame with transitions off, for putting the card back where it
  // started without it visibly flying home — used when what was thrown is
  // replaced (the note you are taken to arrives in the same element).
  const [instant, setInstant] = useState(false)

  // Everything the handlers read, through refs, so the handlers themselves
  // can be stable and never act on a render-old copy of the state.
  const opts = useRef(o)
  opts.current = o
  const posRef = useRef(pos)
  posRef.current = pos
  const pivotRef = useRef(pivot)
  pivotRef.current = pivot
  const thrownRef = useRef(thrown)
  thrownRef.current = thrown

  const drag = useRef<{
    id: number
    sx: number
    sy: number
    x0: number
    y0: number
    // The last two samples, for release velocity. A whole-gesture average
    // would read a drag that paused and then flicked as slow.
    samples: { x: number; y: number; t: number }[]
    armed: boolean
    engaged: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  /** Send it off along a vector, let what is underneath settle, report.
   *
   *  `slower` multiplies the flight time, after the usual bounds. For throws
   *  nobody's hand made — a button press — where the card's leaving is the
   *  only feedback that the answer was taken, so it should be watched rather
   *  than missed. A finger's own throw keeps the speed it was given. */
  const throwCard = useCallback((dir: Direction, vx: number, vy: number, slower = 1) => {
    if (thrownRef.current) return
    drag.current = null
    setDragging(false)
    if (reducedMotion()) {
      opts.current.onThrown(dir)
      return
    }
    const w = opts.current.widthOf()
    const sign = dir === 'right' ? 1 : -1
    const from = posRef.current
    // Far enough that it is fully off screen at any tilt.
    const outX = sign * (window.innerWidth * 0.6 + w)
    const speed = Math.max(Math.hypot(vx, vy), 0.9)
    const ms = Math.round(
      Math.min(THROW_MAX_MS, Math.max(THROW_MIN_MS, Math.abs(outX - from.x) / speed)) * slower,
    )
    // Keep the vertical momentum it was released with.
    const outY = from.y + vy * ms * 0.6
    const next: Throw = { dir, x: outX, y: outY, rot: sign * opts.current.maxTilt * 2 * pivotRef.current, ms }
    thrownRef.current = next
    setThrown(next)
    vibrate(12)
    timer.current = setTimeout(() => opts.current.onThrown(dir), ms + REVEAL_HOLD_MS)
  }, [])

  /** Back to the start. Animated — a spring back in along its own path — or
   *  `instant`, for when the element now holds something new. */
  const reset = useCallback((instantly = false) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    drag.current = null
    thrownRef.current = null
    setThrown(null)
    setDragging(false)
    setPos({ x: 0, y: 0 })
    if (instantly) {
      setInstant(true)
      // Long enough for a frame to paint the reset position with transitions
      // off. A timer, not requestAnimationFrame: a hidden tab runs no frames,
      // and this flag stuck on would leave the card with no animation at all.
      setTimeout(() => setInstant(false), 60)
    }
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const op = opts.current
    if (!op.enabled || thrownRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (op.accept && !op.accept(e)) return
    if (op.capture) e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    setPivot(e.clientY < rect.top + rect.height / 2 ? 1 : -1)
    const p = posRef.current
    drag.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      // Relative to where it already is, so catching it mid-spring does not
      // snap it to the finger.
      x0: e.clientX - p.x,
      y0: e.clientY - p.y / op.yDamp,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
      armed: false,
      engaged: !op.axisLock,
    }
    suppressClick.current = false
    if (!op.axisLock) setDragging(true)
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const op = opts.current

    if (!d.engaged) {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (Math.abs(dx) > LOCK_SLOP_PX && Math.abs(dx) > Math.abs(dy) * LOCK_RATIO) {
        // Ours from here. Measured from this point, so the note does not jump
        // by the slop it took to decide.
        d.engaged = true
        d.x0 = e.clientX
        d.y0 = e.clientY
        setDragging(true)
        // A drag that started on a link must not end by following it.
        suppressClick.current = true
      } else if (Math.abs(dy) > LOCK_SLOP_PX) {
        drag.current = null // a scroll, and the browser already has it
      }
      return
    }

    const x = e.clientX - d.x0
    setPos({ x, y: (e.clientY - d.y0) * op.yDamp })
    d.samples = [...d.samples.slice(-1), { x: e.clientX, y: e.clientY, t: performance.now() }]
    const armed = Math.abs(x) >= op.widthOf() * COMMIT_SHARE
    if (armed !== d.armed) {
      d.armed = armed
      if (armed) vibrate(8) // felt at the moment letting go starts to count
    }
  }, [])

  const onPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      drag.current = null
      if (!d.engaged) return
      setDragging(false)
      const op = opts.current
      const p = posRef.current
      const a = d.samples[0]
      const b = d.samples[d.samples.length - 1]
      const dt = Math.max(1, b.t - a.t)
      // Stale samples are not a velocity: a finger held still and then lifted
      // has none, whatever it was doing before it stopped.
      const idle = performance.now() - b.t > 80
      const vx = idle ? 0 : (b.x - a.x) / dt
      const vy = idle ? 0 : ((b.y - a.y) / dt) * op.yDamp
      const far = Math.abs(p.x) >= op.widthOf() * COMMIT_SHARE
      const flick = Math.abs(vx) >= FLICK_VELOCITY && Math.abs(p.x) >= FLICK_MIN_PX
      // A cancelled pointer (the OS took the gesture) is never an answer. A
      // flick decides by its own direction — the hand's last word counts.
      if (e.type !== 'pointercancel' && (far || flick)) {
        const dir: Direction = flick ? (vx > 0 ? 'right' : 'left') : p.x > 0 ? 'right' : 'left'
        throwCard(dir, vx, vy)
      } else {
        setPos({ x: 0, y: 0 }) // spring back, with overshoot — see the CSS
      }
    },
    [throwCard],
  )

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const w = o.widthOf()
  // -1..1, how committed it currently looks. Drives the stamps and the rise
  // of whatever is underneath, so the answer is visible before letting go.
  const lean = thrown
    ? thrown.dir === 'right' ? 1 : -1
    : Math.max(-1, Math.min(1, pos.x / (w * COMMIT_SHARE)))
  const reveal = thrown ? 1 : Math.abs(lean)

  /** Custom properties for the element being thrown and anything moving
   *  with it (the note's stamps). */
  const vars = {
    '--x': `${thrown ? thrown.x : pos.x}px`,
    '--y': `${thrown ? thrown.y : pos.y}px`,
    '--rot': `${thrown ? thrown.rot : lean * o.maxTilt * 0.6 * pivot}deg`,
    '--throw-ms': `${thrown?.ms ?? 0}ms`,
    '--reveal': reveal,
    // Pivot around where it was held: grabbing low swings the top.
    '--origin': pivot > 0 ? '50% 120%' : '50% -20%',
  } as CSSProperties

  return {
    pos,
    dragging,
    thrown,
    instant,
    lean,
    reveal,
    vars,
    throwCard,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
    },
  }
}
