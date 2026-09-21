// What finishing a note actually records.
//
// The gesture used to write the scores for you: +1 confidence, and nothing
// at all for importance or interest. That was a guess standing in for a
// judgement — the moment you have just finished reading something is the
// only moment you can say how well it landed, how much it matters and
// whether you want more of it, and it was being thrown away.
//
// So the swipe now opens this. Three questions, five taps, submit.
//
// Taps rather than sliders: a slider is a drag with a target, on a control
// six pixels tall, which is the worst possible shape for a thumb. A row of
// numbers is five separate targets that each only need to be hit once.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from '../../ui/icons'
import './reviewDialog.css'

export interface ReviewScores {
  confidence: number
  importance: number
  interest: number
}

/** Confidence can be zero — "read it, none of it stuck" is a real answer and
 *  the one the review list most needs to hear. Importance and interest start
 *  at one: a topic in your vault that matters none at all should be deleted,
 *  not scored. */
const ROWS: { key: keyof ReviewScores; label: string; hint: string; min: number }[] = [
  { key: 'confidence', label: 'Confidence', hint: 'How well do you know this now?', min: 0 },
  { key: 'importance', label: 'Importance', hint: 'How much does it matter to the subject?', min: 1 },
  { key: 'interest', label: 'Interest', hint: 'How much do you want more of it?', min: 1 },
]
const MAX = 5

export function ReviewDialog({
  title,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  title: string
  initial: ReviewScores
  busy: boolean
  error: string | null
  onSubmit: (scores: ReviewScores) => void
  onCancel: () => void
}) {
  const [scores, setScores] = useState<ReviewScores>(initial)
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
            <div className="rd-eyebrow">Finished</div>
            <h2 className="rd-title" id="rd-title">{title}</h2>
          </div>
          <button className="rd-close" onClick={onCancel} disabled={busy} aria-label="Cancel">
            <X width={16} height={16} />
          </button>
        </div>

        <div className="rd-rows">
          {ROWS.map((row) => (
            <div className="rd-row" key={row.key}>
              <div className="rd-row-head">
                <span className="rd-label">{row.label}</span>
                <span className="rd-hint">{row.hint}</span>
              </div>
              <div className="rd-scale" role="radiogroup" aria-label={row.label}>
                {Array.from({ length: MAX - row.min + 1 }, (_, i) => i + row.min).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={scores[row.key] === n}
                    className={'rd-dot' + (scores[row.key] === n ? ' is-on' : '')}
                    disabled={busy}
                    onClick={() => setScores((s) => ({ ...s, [row.key]: n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <div className="rd-error">{error}</div>}

        <div className="rd-foot">
          <button className="rd-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="rd-btn primary" onClick={() => onSubmit(scores)} disabled={busy}>
            {busy ? <span className="spinner" /> : <Check width={15} height={15} />}
            {busy ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
