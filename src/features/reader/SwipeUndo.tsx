// The "Undo" bar after a swipe. Rendered once by App, outside the note, because
// the swipe has already moved the reader on to a different one.
import { useSwipeUndo } from './swipeUndoStore'
import './swipeUndo.css'

export function SwipeUndo() {
  const pending = useSwipeUndo((s) => s.pending)
  const error = useSwipeUndo((s) => s.error)
  const undo = useSwipeUndo((s) => s.undo)

  if (!pending && !error) return null

  return (
    <div className="swipe-undo" role="status" aria-live="polite">
      <span>{error ?? (pending?.skipping ? 'Marked not interested' : 'Marked as finished')}</span>
      {pending && (
        <button className="swipe-undo-btn" onClick={() => void undo()}>
          Undo
        </button>
      )}
    </div>
  )
}
