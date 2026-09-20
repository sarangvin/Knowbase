// "Mark reviewed" — the one action that closes the study loop.
//
// The whole ranking rests on confidence and last_reviewed, but until now the
// only way to move either was to drag a slider and hand-edit a date. This
// does both in one press, at the end of the note, which is where you are
// when you have actually finished reading it.
import { useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import type { Note } from '../../vault/types'
import { requestSpaceGrowth } from '../onboarding/onboardingApi'
import { spaceOfPath } from '../automated-graph/engine'
import { Check, RotateCw } from '../../ui/icons'
import './score.css'

const MAX_CONFIDENCE = 5

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

export function ReviewButton({ note }: { note: Note }) {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const source = useVault((s) => s.source)

  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only on notes that actually take part in the review loop. A note with no
  // confidence and no last_reviewed is prose, not a topic, and a review
  // button there would write frontmatter nobody asked for.
  const tracked = 'confidence' in note.frontmatter || 'last_reviewed' in note.frontmatter
  if (!tracked) return null

  const writable = !!source?.writable && (source.isPathWritable?.(note.path) ?? true)
  const conf = currentConfidence(note.frontmatter)
  const next = Math.min(MAX_CONFIDENCE, conf + 1)
  const atMax = conf >= MAX_CONFIDENCE

  const run = async () => {
    if (busy || !writable) return
    setBusy(true)
    setError(null)
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
      // the press was asking for. Treating that as an error blames the user
      // for the system already being right.
      if (raw !== current.raw) await saveNote(note.path, raw)
      setJustSaved(true)
      // Finishing a topic is exactly when the tree should grow: the server
      // tops it back up to three unstudied topics, using what they now know
      // as the prerequisites for what comes next. Not awaited, and its
      // failure cannot surface here — the review is already saved.
      const space = spaceOfPath(note.path)
      if (space) requestSpaceGrowth(space)
      setTimeout(() => setJustSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="review">
      <button className="review-btn" disabled={busy || !writable} onClick={() => void run()}>
        {justSaved ? <Check /> : <RotateCw />}
        {justSaved ? 'Marked reviewed' : busy ? 'Saving…' : 'Mark reviewed'}
      </button>
      <span className="review-hint">
        {!writable
          ? 'This vault is read-only.'
          : atMax
            ? `Sets last reviewed to today. Confidence stays at ${MAX_CONFIDENCE}/${MAX_CONFIDENCE}.`
            : `Sets last reviewed to today and raises confidence to ${next}/${MAX_CONFIDENCE}.`}
      </span>
      {error && <span className="review-err">{error}</span>}
    </div>
  )
}
