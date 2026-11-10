// Finishing a note: the one write, whichever way the reader got there.
//
// There are four ways to finish a topic now — the Mark reviewed button, the
// swipe-up sheet at the foot of the note, the card either of those opens,
// and (on a phone) throwing the note itself left or right. They must agree
// on everything: whether this note can still be finished today, whether a
// save is in flight, what went wrong, and where the reader goes next. So
// that state lives here, in one hook, created once by NoteView and handed to
// ReviewBar — not held by each control, which is how one ends up saying
// "Review complete" while another still offers to review.
//
// What finishing writes:
//   - last_reviewed = today;
//   - confidence +1, because a review is one of the four things that earn it
//     (see backend/src/vault/confidence.ts for the other three);
//   - interest — 5 or 1 from a swipe, 1-5 from the desktop form — which is
//     what steers the topics written next;
//   - status, following confidence across the space's threshold.
import { useStreak } from '../streak/streakStore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue, upsertFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { computeNextUp, configOf, isReviewedToday, localDay, spaceOfPath, lastReviewedDay, isSkipped } from '../automated-graph/engine'
import type { NextCard } from './InterestSwipe'
import { useCoins } from '../coins/coinStore'
import { pixel } from '../../pixel'
import type { FinishVia } from '../../vault/source'
import { useSwipeUndo } from './swipeUndoStore'

export const MAX_CONFIDENCE = 5

/** What a swipe writes. The ends of the scale, not a nudge: a ±1 step from
 *  the model's opening guess would let "I want more of this" land on a
 *  neutral 3, and the grower reads 4+ and 2- as the reader's votes. The
 *  desktop form writes whatever 1-5 was picked. */
export const INTERESTED = 5
export const NOT_INTERESTED = 1
/** What a note's first finish pays (backend/src/usage/coins.ts). */
const COINS_PER_NOTE = 3

/** How long the finished state stays up before it reverts. */
const HOLD_MS = 1000

/** Touch-first devices only: a laptop with a touchscreen reports
 *  `pointer: coarse` too, and it should not grow swipe gestures, so the
 *  absence of hover is the half of the test that actually decides. */
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

export function useTouchPrimary(): boolean {
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

export function currentConfidence(fm: Record<string, unknown>): number {
  const raw = fm.confidence
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  return Number.isFinite(n) ? Math.min(MAX_CONFIDENCE, Math.max(0, Math.round(n))) : 0
}

export interface NoteFinisher {
  /** A topic note, taking part in the review loop at all. */
  tracked: boolean
  writable: boolean
  reviewedToday: boolean
  busy: boolean
  /** Just finished, for the hold where "Review complete" shows. */
  done: boolean
  error: string | null
  /** Can a finish start right now, by any route. */
  canFinish: boolean
  /** Where finishing on a phone sends you: Next Up's own pick. What the card
   *  and the note reveal underneath themselves. Touch only. */
  next: NextCard | null
  /** Save it. `swiped` finishes land on `next` and can be undone for a moment;
   *  the desktop form goes back to Next Up as it always did. `via` says which
   *  control it was, for telling a thrown note from the finish card. Resolves
   *  true once saved. */
  finish: (interest: number, opts: { swiped: boolean; via: FinishVia }) => Promise<boolean>
  clearError: () => void
  /** Pay this note's coins now, at the moment a swipe is let go, ahead of
   *  `finish` (which then does not pay them again). Only an Interested
   *  first finish pays. */
  payOut: (interested: boolean) => void
}

/** How much of the note the reader had seen when they finished it. */
export interface ReadingStats {
  msOnNote: number
  scrollDepth: number
  scrollTop: number
}

export function useFinishNote(note: Note | undefined, touch: boolean, readingStats: () => ReadingStats): NoteFinisher {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const openNote = useVault((s) => s.openNote)
  const source = useVault((s) => s.source)
  const index = useVault((s) => s.index)

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The note whose coins a swipe already paid at the moment it was let go.
  const paidRef = useRef<string | null>(null)

  const path = note?.path ?? ''
  const fm = note?.frontmatter ?? {}
  // Only notes that take part in the review loop. A note with no confidence
  // and no last_reviewed is prose, not a topic, and finishing it would write
  // frontmatter nobody asked for.
  const tracked = !!note && ('confidence' in fm || 'last_reviewed' in fm)
  const writable = !!note && !!source?.writable && (source.isPathWritable?.(path) ?? true)
  // One review per note per day. Spacing is the whole mechanism; letting
  // confidence be walked up to 5 in one sitting would make the ranking
  // describe an afternoon's enthusiasm rather than what has stuck.
  const reviewedToday = !!note && isReviewedToday(fm)
  const space = note ? spaceOfPath(path) : null
  const canFinish = tracked && writable && !reviewedToday && !busy && !done

  // What is underneath, on a phone: the note Next Up would pick once this one
  // is done. The same ranking, not a guess at it, so what is revealed is where
  // you are taken. This note is excluded because it is about to stop being
  // new; anything already reviewed today because it could not be reviewed.
  const eligible = touch && tracked && writable && !reviewedToday
  const next = useMemo<NextCard | null>(() => {
    if (!eligible || !index || !space) return null
    const r = computeNextUp(index, space)
    const fresh = r.ranked.find((t) => t.path !== path)
    if (fresh) return { path: fresh.path, title: fresh.title, kind: 'new', pending: fresh.pending }
    const again = r.review.find((t) => t.path !== path && t.lastReviewed !== localDay())
    return again ? { path: again.path, title: again.title, kind: 'review', pending: again.pending } : null
  }, [eligible, index, space, path])

  // A new note starts from nothing, and an error from the last one is about
  // a note you are no longer looking at.
  useEffect(() => {
    setError(null)
    setDone(false)
    if (holdRef.current) clearTimeout(holdRef.current)
  }, [path])
  useEffect(() => () => void (holdRef.current && clearTimeout(holdRef.current)), [])

  const finish = async (interest: number, opts: { swiped: boolean; via: FinishVia }): Promise<boolean> => {
    if (busy || !note) return false
    setBusy(true)
    setError(null)
    try {
      // Re-read rather than trusting the rendered copy: a background draft
      // may have rewritten the body since this note was displayed, and a
      // quiz answer or a flashcard may have moved its confidence.
      const current = getNote(path)
      if (!current) throw new Error('note not found')
      // "Not interested" passes the note over rather than finishing it: it
      // is dated (so what builds on it unlocks and the collection grows past
      // it) and marked skipped, but earns no confidence, no streak day and no
      // coins, and stays out of the quiz and flashcards — see isSkipped.
      const skipping = interest <= NOT_INTERESTED
      const threshold = index && space ? configOf(index, space).confidence_threshold : 3
      const confidence = skipping
        ? currentConfidence(current.frontmatter)
        : Math.min(MAX_CONFIDENCE, currentConfidence(current.frontmatter) + 1)
      let raw = setFrontmatterValue(current.raw, 'last_reviewed', localDay())
      raw = setFrontmatterValue(raw, 'confidence', confidence)
      raw = setFrontmatterValue(raw, 'interest', interest)
      // Written either way once present, so changing your mind later on a
      // skipped note (finishing it as interested) makes it complete.
      if (skipping || 'skipped' in current.frontmatter) raw = upsertFrontmatterValue(raw, 'skipped', skipping ? 'true' : 'false')
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
      const { msOnNote, scrollDepth, scrollTop } = readingStats()
      // Coins are paid the moment the note is finished, not after the save
      // and the undo window: a reward that arrives seconds later does not
      // feel like one. Only a note's first finish pays (the server counts one
      // per note), and a skipped note was never finished, so finishing it
      // now is a first. The server stays the authority: an undo or a failed
      // save re-syncs the balance (swipeUndoStore, below).
      const firstFinish = !skipping && (!lastReviewedDay(current.frontmatter) || isSkipped(current.frontmatter))
      if (firstFinish && paidRef.current !== path) useCoins.getState().grant(COINS_PER_NOTE)
      paidRef.current = null
      if (raw !== current.raw) {
        try {
          await saveNote(path, raw, { finish: { via: opts.via, msOnNote, scrollDepth } })
        } catch (e) {
          if (firstFinish) useCoins.getState().sync()
          throw e
        }
      }
      // Once the server has logged the finish, quietly confirm the balance.
      if (firstFinish) useCoins.getState().sync(2500)
      if (skipping && opts.swiped) pixel('note_swipe_left')
      const settle = () => {
        if (!skipping) {
          // A note finished for the first time is a streak day. Whether it was
          // the first time is the server's call; it is asked either way.
          useStreak.getState().goalAction()
        }
        // Finishing a topic is exactly when the tree should grow: the server
        // tops it back up, using what they now know as the prerequisites and
        // what they just said about interest as the steer. Not awaited, and
        // its failure cannot surface here — the review is already saved.
        if (space) requestSpaceGrowth(space)
      }
      // A swipe can be a mistake, so what follows from it waits until it stands.
      if (opts.swiped) {
        useSwipeUndo.getState().offer({ path, previousRaw: current.raw, skipping, scrollTop, commit: settle })
      } else {
        settle()
      }
      // After a swipe, onto what was revealed underneath — landing there is
      // keeping a promise the gesture made. The desktop form showed nothing
      // underneath, and goes back to Next Up as it always did.
      if (opts.swiped && next) openNote(next.path)
      else if (space) openNote(`Automated Graph/${space}/Next Up.md`)
      else {
        setDone(true)
        holdRef.current = setTimeout(() => setDone(false), HOLD_MS)
      }
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    tracked,
    writable,
    reviewedToday,
    busy,
    done,
    error,
    canFinish,
    next,
    finish,
    clearError: () => setError(null),
    payOut: (interested) => {
      if (!interested || !note || !canFinish || paidRef.current === path) return
      const fm = getNote(path)?.frontmatter ?? note.frontmatter
      if (lastReviewedDay(fm) && !isSkipped(fm)) return
      paidRef.current = path
      useCoins.getState().grant(COINS_PER_NOTE)
    },
  }
}
