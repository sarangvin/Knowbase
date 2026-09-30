// What finishing a note asks on a desktop: how much do you want more of this?
//
// Desktop only. On a phone the same question is a card you swipe away (see
// InterestSwipe.tsx) — a thumb is built for that and a mouse is not, and a
// row of numbers is the shape a pointer is good at. ReviewBar picks between
// them.
//
// This used to be three rows — confidence, importance and interest. Two
// went: confidence is earned now rather than declared (+1 for the review
// itself, and see backend/src/vault/confidence.ts for the rest), and
// importance was dropped from the app. Interest is the one answer only the
// reader has, and it steers what gets generated next.
//
// A 1-5 here and a swipe on a phone land on the same scale: the swipe
// writes the ends (5 or 1), and the grower reads 4+ as "more like this" and
// 2- as "not for me", with 3 counting as no opinion.
//
// Taps rather than a slider: a slider is a drag with a target on a control
// six pixels tall. A row of numbers is five targets that each only need
// hitting once.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from '../../ui/icons'
import './reviewDialog.css'

export interface ReviewScores {
  interest: number
}

/** Starts at one: a topic you want none of at all is a 1, not a 0. */
const ROWS: { key: keyof ReviewScores; label: string; hint: string; min: number }[] = [
  { key: 'interest', label: 'Interest', hint: 'How much do you want more like this?', min: 1 },
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
            <div className="rd-eyebrow">Finished · confidence +1</div>
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
