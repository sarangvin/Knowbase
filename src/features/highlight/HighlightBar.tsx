// The strip under the top bar while highlighting: what to do next, then what
// happened. The words themselves are picked in HighlightLayer.tsx.
import { useEffect } from 'react'
import { useVault } from '../../vault/vaultStore'
import { useHighlight } from './highlightStore'
import { PAYMENTS_ENABLED } from '../settings/plans'
import './highlight.css'

export function HighlightBar({ notePath }: { notePath: string }) {
  const { active, busy, selection, message, made, upsell, dismiss } = useHighlight()
  const openNote = useVault((s) => s.openNote)
  const openView = useVault((s) => s.openView)

  // The class that turns the system selection off while highlighting (highlight.css).
  useEffect(() => {
    document.body.classList.toggle('highlighting', active)
    return () => document.body.classList.remove('highlighting')
  }, [active])

  // Leaving the note ends highlight mode; a result belongs to the note it was made on.
  useEffect(() => () => dismiss(), [notePath, dismiss])

  if (!active && !made && !message) return null

  return (
    <div className={'highlight-bar' + (active ? ' is-active' : '')} role="status">
      <div className="highlight-bar-text">
        {busy ? (
          <>
            <span className="spinner" /> Making a note on “{selection}”…
          </>
        ) : made ? (
          <>
            {made.created ? 'New note' : 'Linked to'}{' '}
            <button className="highlight-bar-link" onClick={() => openNote(made.path)}>
              {made.title}
            </button>
            {made.created ? ' — it’s being written now.' : ' — already in this collection.'}
          </>
        ) : message ? (
          <span className="highlight-bar-error">{message}</span>
        ) : selection ? (
          <>
            “{selection.length > 60 ? selection.slice(0, 60) + '…' : selection}” — tap the highlighter again to
            make it a note.
          </>
        ) : (
          'Tap a word to highlight it, drag the ends to take in more, then tap the highlighter again.'
        )}
      </div>
      <div className="highlight-bar-actions">
        {upsell && PAYMENTS_ENABLED && (
          <button className="ask-btn primary" onClick={() => openView({ kind: 'settings' })}>
            Upgrade to Pro
          </button>
        )}
        {!busy && (
          <button className="ask-btn" onClick={dismiss}>
            {active ? 'Cancel' : 'Done'}
          </button>
        )}
      </div>
    </div>
  )
}
