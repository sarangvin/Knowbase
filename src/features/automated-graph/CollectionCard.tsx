// One collection on the home screen, and the menu that manages it.
//
// The card is a div with role="button" rather than a <button>, because the ⋮
// menu is a real button and a button may not contain one. Same reason the
// flashcard gave up being a button when the bookmark moved inside it.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { MoreVertical, Archive, Trash } from '../../ui/icons'
import { setCollectionArchived, deleteCollection } from './collectionsApi'

export interface CollectionSummary {
  space: string
  total: number
  studied: number
  openPath: string | null
}

export function CollectionCard({
  summary,
  onChanged,
}: {
  summary: CollectionSummary
  /** Reload the vault. Both actions change it on the server, and the index
   *  in memory has no idea until it is re-read. */
  onChanged: () => void
}) {
  const { space, total, studied, openPath } = summary
  const openNote = useVault((s) => s.openNote)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState<null | 'archive' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // A menu that only closes via its own items is a menu you get stuck in.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const run = async (kind: 'archive' | 'delete', fn: () => Promise<unknown>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      setMenuOpen(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const archive = () => void run('archive', () => setCollectionArchived(space, true))

  const remove = () => {
    // Irreversible and not small — the only thing standing between a
    // mis-tap and someone's notes. The count is in the question because
    // "delete Marine Biology" and "delete 22 notes" land differently.
    const ok = confirm(
      `Delete "${space}" and its ${total} note${total === 1 ? '' : 's'}?\n\n` +
        `This cannot be undone. Your progress on them goes too.\n\n` +
        `Archiving instead keeps everything and just takes it off this screen.`,
    )
    if (!ok) return
    void run('delete', () => deleteCollection(space))
  }

  const pct = total > 0 ? Math.round((studied / total) * 100) : 0

  return (
    <div className="collection-wrap" ref={wrapRef}>
      <div
        role="button"
        tabIndex={openPath ? 0 : -1}
        aria-disabled={!openPath}
        className={'collection-card' + (openPath ? '' : ' is-disabled')}
        onClick={() => openPath && openNote(openPath)}
        onKeyDown={(e) => {
          if (!openPath) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openNote(openPath)
          }
        }}
      >
        <div className="collection-name">{space}</div>
        <div className="collection-meta">
          {total} topic{total === 1 ? '' : 's'} · {studied} studied
        </div>
        {total > 0 && (
          <div className="collection-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <button
        type="button"
        className="collection-menu-btn"
        aria-label={`Manage ${space}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <MoreVertical width={16} height={16} />
      </button>

      {menuOpen && (
        <div className="collection-menu" role="menu">
          <button className="collection-menu-item" role="menuitem" disabled={busy != null} onClick={archive}>
            <Archive width={14} height={14} /> Archive
          </button>
          <button
            className="collection-menu-item is-danger"
            role="menuitem"
            disabled={busy != null}
            onClick={remove}
          >
            <Trash width={14} height={14} /> Delete
          </button>
        </div>
      )}

      {error && <div className="collection-error">{error}</div>}
    </div>
  )
}
