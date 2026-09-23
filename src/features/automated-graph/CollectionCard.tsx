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
  /** Topics whose body has actually been written — the rest are one-line
   *  stubs the draft queue has not reached, which Next Up marks "Coming
   *  soon". A card that counted those as topics said "5 topics · 0 studied"
   *  for a collection with nothing in it yet to read. */
  written: number
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
  const { space, total, studied, written, openPath } = summary
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
          {written < total ? (
            // Still filling in. The honest number here is how much there is
            // to read, not how many folders exist.
            <>
              {written} of {total} notes written
              {studied > 0 && ` · ${studied} studied`}
            </>
          ) : (
            <>
              {total} topic{total === 1 ? '' : 's'} · {studied} studied
            </>
          )}
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

/** A collection that has been asked for but does not exist yet.
 *
 *  It stands in the grid where the real card will be, with the topic the
 *  reader typed as its title. That placement is the point: a bar at the foot
 *  of the screen said "building your space on X" in a place the collection
 *  would never appear, and said it once however many were building. Two
 *  collections requested at once produced one message.
 *
 *  Deliberately not clickable and not a button. There is nothing to open —
 *  the space has no landing note until the plan comes back — and a card that
 *  looks pressable and does nothing is worse than one that plainly is not
 *  ready.
 */
/** How long a build may run before the card says so.
 *
 *  A collection normally appears in a few seconds. Past half a minute
 *  something is being retried, and the reader is watching a spinner with no
 *  idea whether it is stuck — which is when people reload, and reloading is
 *  the one thing that cannot help. Saying "come back in a bit" is both true
 *  and the most useful instruction available. */
const SLOW_AFTER_MS = 30_000

export function BuildingCard({ topic, drafted, total, error, onRetry, busy, startedAt }: {
  topic: string
  drafted: number
  total: number
  /** ISO, from the server. Read from the job rather than remembered here,
   *  so the message survives the reload it is trying to prevent. */
  startedAt?: string
  /** Set when the build failed; the card carries the retry rather than a
   *  separate banner, so the failure is reported where the thing was
   *  expected to appear. */
  error?: string | null
  onRetry?: () => void
  busy?: boolean
}) {
  const failed = !!error

  // Re-rendered on a timer rather than computed once: the card is usually
  // mounted before the thirty seconds are up, and nothing else would make
  // it say so when they pass. Cleared as soon as the message is showing —
  // there is no second thing to wait for.
  const began = startedAt ? new Date(startedAt).getTime() : null
  const [now, setNow] = useState(() => Date.now())
  const slow = !failed && began !== null && now - began > SLOW_AFTER_MS
  useEffect(() => {
    if (failed || began === null || slow) return
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [failed, began, slow])

  return (
    <div className={'collection-card is-building' + (failed ? ' is-failed' : '')} aria-live="polite">
      <div className="collection-name">
        {!failed && <span className="spinner building-spinner" aria-hidden="true" />}
        {topic}
      </div>
      <div className="collection-meta">
        {failed
          ? error
          : slow
            ? 'Taking longer than expected — come back in some time.'
            : total > 0
              ? `Writing the notes — ${drafted} of ${total} done`
              : 'Working out what to cover…'}
      </div>
      {failed ? (
        onRetry && (
          <button className="collection-retry" onClick={onRetry} disabled={busy}>
            {busy ? 'Starting…' : 'Try again'}
          </button>
        )
      ) : (
        <div className="collection-bar" aria-hidden="true">
          {/* Indeterminate until the plan says how many notes there are;
              there is no honest percentage before that. */}
          <span
            className={total > 0 ? '' : 'is-indeterminate'}
            style={total > 0 ? { width: `${Math.round((drafted / total) * 100)}%` } : undefined}
          />
        </div>
      )}
    </div>
  )
}
