// The strip under the top bar while highlighting: what to do next, then what
// happened. Also where the selection is captured — see highlightStore.ts for
// why it is captured as it is made.
import { useEffect } from 'react'
import { useVault } from '../../vault/vaultStore'
import { useHighlight } from './highlightStore'
import { PAYMENTS_ENABLED } from '../settings/plans'
import './highlight.css'

export function HighlightBar({ notePath }: { notePath: string }) {
  const { active, busy, selection, message, made, upsell, capture, dismiss } = useHighlight()
  const openNote = useVault((s) => s.openNote)
  const openView = useVault((s) => s.openView)

  // Only words inside the note itself count, not the top bar or a dialog.
  useEffect(() => {
    if (!active) return
    const onChange = () => {
      const sel = window.getSelection()
      const node = sel?.anchorNode
      const el = node instanceof Element ? node : node?.parentElement
      if (!sel || !el?.closest('.note-container')) return
      const text = sel.toString().replace(/\s+/g, ' ').trim()
      if (text) capture(text)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [active, capture])

  // Selections show in the highlighter colour while the mode is on (highlight.css).
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
          'Select a word or phrase in the note, then tap the highlighter again.'
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
