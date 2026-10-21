// The one-time hint for finishing a note.
//
// Finishing is the whole loop — it marks the note done, it is what earns a
// streak day and coins, and the interest it records is what the next notes
// are written from — but the gesture for it is invisible until you know it
// is there: on a phone you throw the note itself sideways. So the first
// time someone opens a note they could finish, this says how, once.
//
// Shown only to readers who have never finished a note (no note in their
// vault has `last_reviewed`), so nobody who already knows is interrupted,
// and remembered per account on this device once dismissed. Storage can
// throw; losing it costs one repeated hint, nothing else.
//
// The demo card rocks right then left with the two stamps the real note
// shows, so the picture and the gesture match. On a desktop there is no
// swipe: the hint points at "Mark reviewed" instead.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVault } from '../../vault/vaultStore'
import { useStreak } from '../streak/streakStore'
import './finishHint.css'

const SEEN_KEY = 'kb:finish-hint-seen'
/** Let the note paint before anything covers it. */
const SHOW_AFTER_MS = 700

function seen(userId: string): boolean {
  try {
    return localStorage.getItem(`${SEEN_KEY}:${userId}`) === '1'
  } catch {
    return false
  }
}

function markSeen(userId: string): void {
  try {
    localStorage.setItem(`${SEEN_KEY}:${userId}`, '1')
  } catch {
    // Shown again next time; nothing depends on it.
  }
}

export function FinishHint({ active, touch }: { active: boolean; touch: boolean }) {
  const userId = useVault((s) => s.user?.id)
  const index = useVault((s) => s.index)
  const celebration = useStreak((s) => s.celebration)
  const [open, setOpen] = useState(false)

  const finishedAny =
    !!index && [...index.notes.values()].some((n) => n.frontmatter?.last_reviewed != null)
  const due = active && !!userId && !finishedAny && !seen(userId)

  useEffect(() => {
    if (!due) return
    const t = setTimeout(() => setOpen(true), SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [due])

  const close = () => {
    if (userId) markSeen(userId)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // One card at a time: a streak celebration goes first.
  if (!open || celebration) return null

  return createPortal(
    <div className="fh-backdrop" onClick={close}>
      <div className="fh-card" role="dialog" aria-label="How to finish a note" onClick={(e) => e.stopPropagation()}>
        <div className="fh-demo" aria-hidden="true">
          <div className="fh-under" />
          <div className={`fh-page${touch ? ' swipes' : ''}`}>
            <span className="fh-line w80" />
            <span className="fh-line w95" />
            <span className="fh-line w60" />
            <span className="fh-line w90" />
            <span className="fh-line w40" />
            {touch ? (
              <>
                <span className="fh-stamp yes">More like this</span>
                <span className="fh-stamp no">Not for me</span>
              </>
            ) : (
              <span className="fh-button">Mark reviewed</span>
            )}
          </div>
          {touch && <span className="fh-finger" />}
        </div>

        {touch ? (
          <>
            <div className="fh-title">Swipe to finish a note</div>
            <p className="fh-line-text">
              When you have read it, swipe the note <strong>right</strong> if you want more like it, or{' '}
              <strong>left</strong> if it is not for you.
            </p>
          </>
        ) : (
          <>
            <div className="fh-title">Finish a note when you have read it</div>
            <p className="fh-line-text">
              Press <strong>Mark reviewed</strong> at the end of the notes and say whether you want more like it.
            </p>
          </>
        )}
        <p className="fh-sub">That marks it done, and your next notes are written around what you are interested in.</p>

        <button className="ob-btn primary fh-ok" onClick={close} autoFocus>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  )
}
