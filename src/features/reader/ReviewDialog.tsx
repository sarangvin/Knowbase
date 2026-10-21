// What finishing a note asks on a desktop: do you want more like this?
//
// Desktop only. On a phone the same question is a card you swipe away (see
// InterestSwipe.tsx); ReviewBar picks between them. Both give the same two
// answers — it used to be a 1-5 row here, and a middle number was nobody's
// real answer:
//
//   Interested      finishes the note: confidence +1, a streak day, coins,
//                   and more like it gets written.
//   Not interested  passes it over: it is marked skipped, earns nothing,
//                   stays out of the quiz and flashcards, and steers what
//                   gets written away from it (useFinishNote, isSkipped).
//
// One tap answers and saves; there is no separate Submit to press.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from '../../ui/icons'
import { INTERESTED, NOT_INTERESTED } from './useFinishNote'
import './reviewDialog.css'

export interface ReviewScores {
  interest: number
}

export function ReviewDialog({
  title,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  title: string
  /** What the note already says, so the matching answer is the default. */
  initial: ReviewScores
  busy: boolean
  error: string | null
  onSubmit: (scores: ReviewScores) => void
  onCancel: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes, and focus starts inside — a dialog you can only leave by
  // hitting a small × is a trap on a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  // Portalled to <body> rather than rendered where it is called from. On
  // touch the caller is the review sheet, which is `position: sticky` with a
  // z-index of its own — that makes a stacking context, and an overlay
  // inside it is confined to it however high its own z-index goes. The
  // symptom was the bottom nav painting over the Submit button.
  return createPortal(
    <div className="rd-overlay" onClick={() => !busy && onCancel()}>
      <div
        className="rd-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd-title"
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-head">
          <div>
            <div className="rd-eyebrow">Finished reading</div>
            <h2 className="rd-title" id="rd-title">{title}</h2>
          </div>
          <button className="rd-close" onClick={onCancel} disabled={busy} aria-label="Cancel">
            <X width={16} height={16} />
          </button>
        </div>

        <p className="rd-ask">Do you want more like this?</p>
        <div className="rd-choices">
          <button
            className="rd-choice"
            disabled={busy}
            autoFocus={initial.interest <= NOT_INTERESTED}
            onClick={() => onSubmit({ interest: NOT_INTERESTED })}
          >
            <X width={16} height={16} />
            Not interested
          </button>
          <button
            className="rd-choice primary"
            disabled={busy}
            autoFocus={initial.interest > NOT_INTERESTED}
            onClick={() => onSubmit({ interest: INTERESTED })}
          >
            {busy ? <span className="spinner" /> : <Check width={16} height={16} />}
            Interested
          </button>
        </div>
        <p className="rd-note">Not interested skips this note: it won’t count as finished or show up in your quiz and flashcards.</p>

        {error && <div className="rd-error">{error}</div>}

      </div>
    </div>,
    document.body,
  )
}
