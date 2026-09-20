// "Keep scrolling to mark reviewed" — the gesture behind the review tab.
//
// Marking a note reviewed is the one write that a misplaced tap shouldn't be
// able to make, because it moves the note out of the queue and bumps
// confidence. A button solves that with a target you have to aim at; this
// solves it with effort instead — you have to reach the end of the note and
// then keep pushing. Reaching the end is the part that means "I read this".
//
// Two input models, because a finger and a wheel are not the same thing:
//
//   Touch — pull-to-refresh, upside down. Once the container is at its
//   bottom, further drag is measured as distance and *held* while the finger
//   stays down, so resting at 80% keeps it at 80%. Lifting off early springs
//   it back. This is a gesture people already know from every mobile app,
//   just inverted, so it needs no teaching.
//
//   Wheel/trackpad — there is no "hold": a wheel emits discrete deltas and a
//   trackpad emits a stream that stops the instant you lift your fingers. So
//   progress accumulates from delta and bleeds away when input stops. The
//   felt experience is the same ("keep pushing"), and it means one flick of
//   inertia can't carry you over the line on its own.
//
// Both commit at 1. Nothing here fires on release, so there is no moment
// where you have already passed the threshold and are waiting to find out.
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Overscroll distance, in CSS px, that fills the bar under a finger. About
 *  a thumb's travel — far enough that no ordinary flick reaches it. */
const PULL_PX = 110

/** Accumulated wheel delta that fills the bar. Larger than PULL_PX because
 *  trackpad deltas are cheap: a single two-finger swipe easily emits 300px
 *  of delta. */
const WHEEL_PX = 380

/** A quiet gap this long starts a new wheel gesture. Trackpad momentum on
 *  macOS keeps emitting events every frame for up to a second after the
 *  fingers lift, so anything under ~100ms is still the same push. */
const GESTURE_GAP_MS = 140

/** Progress lost per ms with no wheel input — a full bar drains in ~0.5s. */
const DECAY_PER_MS = 1 / 500

/** Treat "within 2px of the bottom" as the bottom: fractional scroll
 *  positions from zoom and subpixel layout mean the numbers rarely land
 *  exactly equal. */
const BOTTOM_EPS = 2

export interface ScrollReview {
  /** 0–1. Drives the fill and the label. */
  progress: number
  /** The scroller is at its end, so the gesture is available right now. */
  armed: boolean
}

/**
 * Watches a scroll container for sustained overscroll past its end.
 *
 * `onComplete` fires once per fill and is not awaited; the caller owns the
 * actual write and its busy state, and should flip `enabled` off while that
 * runs so a continued push can't queue a second one.
 */
export function useScrollReview(
  scrollRef: RefObject<HTMLElement | null>,
  { enabled, onComplete }: { enabled: boolean; onComplete: () => void },
): ScrollReview {
  const [progress, setProgress] = useState(0)
  const [armed, setArmed] = useState(false)

  // Read inside listeners that are attached once, so they must not close over
  // a stale render's values.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete

  // Progress is mirrored in a ref because the wheel decay loop and the event
  // handlers both read-modify-write it faster than React re-renders.
  const pRef = useRef(0)
  // Latches when a fill fires, so holding at the top edge cannot mark the
  // note twice. Lives outside the listener effect because the `enabled`
  // effect below has to be able to clear it after a completed write.
  const firedRef = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let touching = false
    let pullFrom: number | null = null
    let lastWheel = 0
    let gestureFromBottom = false
    let raf = 0

    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPS

    const set = (v: number) => {
      const next = Math.max(0, Math.min(1, v))
      if (next === pRef.current) return
      pRef.current = next
      setProgress(next)
      // Fire on the way up, not on release.
      if (next >= 1 && !firedRef.current) {
        firedRef.current = true
        completeRef.current()
      } else if (next === 0) {
        firedRef.current = false
      }
    }

    // Wheel decay. Only runs while there is something to drain and no finger
    // is holding a position.
    const tick = (now: number) => {
      raf = 0
      if (touching || pRef.current <= 0) return
      const dt = now - lastWheel
      if (dt > 60) set(pRef.current - (dt - 60) * DECAY_PER_MS)
      if (pRef.current > 0) raf = requestAnimationFrame(tick)
    }
    const pump = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onScroll = () => {
      const b = atBottom()
      setArmed(b)
      if (!b) gestureFromBottom = false
      // Scrolling back up abandons the gesture outright rather than letting
      // it decay: the user has visibly changed their mind.
      if (!b && pRef.current > 0) set(0)
    }

    const onWheel = (e: WheelEvent) => {
      const now = performance.now()
      // A push that began somewhere up the note and coasted to the end does
      // not count — otherwise a hard flick to the bottom would mark the note
      // reviewed on its own momentum, which is the one thing this control
      // exists to prevent. Only a push that *starts* at the end counts, so
      // the user has to lift off and deliberately go again.
      if (now - lastWheel > GESTURE_GAP_MS) gestureFromBottom = atBottom()
      lastWheel = now
      if (!enabledRef.current || !gestureFromBottom || !atBottom()) return
      // deltaMode 1 = lines, 2 = pages. Firefox reports lines for a real
      // mouse wheel, so an unnormalised delta would be ~40x too small there.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const dy = e.deltaY * unit
      if (dy <= 0) return
      // There is nothing left to scroll, so the only thing preventDefault
      // suppresses is the overscroll bounce / scroll chaining to the page —
      // both of which would fight the fill for the same input.
      e.preventDefault()
      set(pRef.current + dy / WHEEL_PX)
      pump()
    }

    const onTouchStart = () => {
      touching = true
      pullFrom = null
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!enabledRef.current || e.touches.length !== 1) return
      const y = e.touches[0].clientY
      if (!atBottom()) {
        // Still scrolling the note. Re-anchor so the pull is measured from
        // wherever the finger happens to be when the end is reached, not
        // from where the whole drag began.
        pullFrom = null
        return
      }
      if (pullFrom === null) pullFrom = y
      const dy = pullFrom - y // up-drag is positive
      if (dy <= 0) {
        set(0)
        pullFrom = y
        return
      }
      // Only claim the event once we are actually pulling, so a downward
      // drag at the bottom still scrolls back up normally.
      if (e.cancelable) e.preventDefault()
      set(dy / PULL_PX)
    }

    const onTouchEnd = () => {
      touching = false
      pullFrom = null
      // Short of the line: spring back. The CSS transition makes this read as
      // a release rather than a glitch.
      if (pRef.current < 1) set(0)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    onScroll() // a note shorter than the pane is already at its end

    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [scrollRef])

  // Drop any part-filled bar when the gesture is switched off (the write
  // started, or the note changed under it).
  useEffect(() => {
    if (enabled) return
    firedRef.current = false
    if (pRef.current > 0) {
      pRef.current = 0
      setProgress(0)
    }
  }, [enabled])

  return { progress, armed }
}
