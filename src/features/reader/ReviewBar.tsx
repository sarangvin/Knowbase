// Marking a note reviewed.
//
// It used to live at the foot of the scroller — a button on a laptop, and on
// a phone an orange sheet you swiped up into once the whole note had gone
// past. The gesture was built on a premise that has since stopped holding:
// that the end of the scroller is the end of the reading. It is not. A topic
// note is AI Notes, then Useful Links, then My Notes, then Questions — and
// the last two are optional exercises. Putting the only way to finish a note
// underneath them meant scrolling past every question to say you had read
// the prose, which is a toll on the one action the whole review loop depends
// on people taking.
//
// So the control now sits directly under AI Notes, where the reading
// actually ends, and it is the same button everywhere. An overscroll gesture
// cannot be moved into the middle of a document: it is armed by the scroller
// having nothing left to scroll, and there is a My Notes box and a Questions
// list below this point. Keeping the sheet as well would have meant two
// controls writing the same frontmatter on one screen.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { configOf, isReviewedToday, localDay, spaceOfPath } from '../automated-graph/engine'
import { Check, RotateCw } from '../../ui/icons'
import { ReviewDialog, type ReviewScores } from './ReviewDialog'
import './score.css'

const MAX_CONFIDENCE = 5

/** How long the finished state stays up before it reverts. Long enough to
 *  read "Review complete", short enough that it never feels like a dialog
 *  waiting to be dismissed. */
const HOLD_MS = 1000

function currentConfidence(fm: Record<string, unknown>): number {
  const raw = fm.confidence
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  return Number.isFinite(n) ? Math.min(MAX_CONFIDENCE, Math.max(0, Math.round(n))) : 0
}

function scoreOf(fm: Record<string, unknown>, key: string, fallback: number): number {
  const raw = fm[key]
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function clamp(n: number, min: number): number {
  return Math.min(MAX_CONFIDENCE, Math.max(min, n))
}

export function ReviewBar({ note }: { note: Note }) {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const openNote = useVault((s) => s.openNote)
  const source = useVault((s) => s.source)
  const index = useVault((s) => s.index)

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The button no longer writes anything by itself: it opens this.
  const [asking, setAsking] = useState(false)

  // Only on notes that actually take part in the review loop. A note with no
  // confidence and no last_reviewed is prose, not a topic, and a review
  // control there would write frontmatter nobody asked for.
  const tracked = 'confidence' in note.frontmatter || 'last_reviewed' in note.frontmatter
  const writable = !!source?.writable && (source.isPathWritable?.(note.path) ?? true)
  // The starting point for the dialog, not an increment: the score is
  // asked for now rather than assumed, so there is nothing to add one to.
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
  const threshold = index && space ? configOf(index, space).confidence_threshold : 3

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Ask, do not assume. */
  const ask = () => {
    if (busy || done || asking || !writable || !tracked || reviewedToday) return
    setError(null)
    setAsking(true)
  }

  const submit = async (scores: ReviewScores) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Re-read rather than trusting the rendered copy: a background draft
      // may have rewritten the body since this note was displayed.
      const current = getNote(note.path)
      if (!current) throw new Error('note not found')
      let raw = setFrontmatterValue(current.raw, 'last_reviewed', localDay())
      // The user's own numbers, not a guess. Every one of these is written,
      // including ones they left where they were — a slider left alone is
      // still an answer, and writing it keeps the note's three scores a
      // single consistent snapshot rather than a mix of eras.
      raw = setFrontmatterValue(raw, 'confidence', scores.confidence)
      raw = setFrontmatterValue(raw, 'importance', scores.importance)
      raw = setFrontmatterValue(raw, 'interest', scores.interest)
      // Status follows confidence in both directions. It only ever moved up
      // while the gesture could only add one; now that the number is typed
      // in, it can come down, and a note stuck on "known" at 1/5 would lie
      // to anyone reading the vault in Obsidian.
      const status = note.frontmatter.status
      if (scores.confidence >= threshold && status === 'frontier') {
        raw = setFrontmatterValue(raw, 'status', 'known')
      } else if (scores.confidence < threshold && status === 'known') {
        raw = setFrontmatterValue(raw, 'status', 'frontier')
      }
      if (raw !== current.raw) await saveNote(note.path, raw)
      // Finishing a topic is exactly when the tree should grow: the server
      // tops it back up to three unstudied topics, using what they now know
      // as the prerequisites for what comes next. Not awaited, and its
      // failure cannot surface here — the review is already saved.
      if (space) requestSpaceGrowth(space)
      setAsking(false)
      // Back to where the decision about what to read next gets made. The
      // note is finished; leaving them halfway down it with nothing to do
      // would make them find their own way out.
      if (space) openNote(`Automated Graph/${space}/Next Up.md`)
      else setDone(true)
      holdRef.current = setTimeout(() => setDone(false), HOLD_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // A new note starts clean, and an error from the last one is about a note
  // you are no longer looking at.
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
  // without this the button would vanish mid-"Review complete".
  if (reviewedToday && !done) return null

  const detail = 'Asks how it went, then records your scores and today’s date.'

  // Pre-filled with what the note already says, so leaving a row alone
  // keeps its value rather than resetting it to some default.
  const initial: ReviewScores = {
    confidence: conf,
    importance: clamp(scoreOf(note.frontmatter, 'importance', 3), 1),
    interest: clamp(scoreOf(note.frontmatter, 'interest', 3), 1),
  }

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
      {asking && (
        <ReviewDialog
          title={note.title}
          initial={initial}
          busy={busy}
          error={error}
          onSubmit={(sc) => void submit(sc)}
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
