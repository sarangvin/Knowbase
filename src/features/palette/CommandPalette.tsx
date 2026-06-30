// Command palette (⌘P / Ctrl-P). Functional now with the core commands; the
// workflow may extend the registry. Self-contained modal driven by store.paletteOpen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { Command } from '../../ui/icons'

interface Cmd {
  id: string
  title: string
  hint?: string
  run: () => void
}

export function CommandPalette() {
  const open = useVault((s) => s.paletteOpen)
  const setOpen = useVault((s) => s.setPaletteOpen)
  const store = useVault()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Cmd[]>(
    () => [
      { id: 'graph', title: 'Open graph view', run: () => store.openView({ kind: 'graph' }) },
      {
        id: 'mode',
        title: store.mode === 'read' ? 'Edit current note' : 'Preview (reading view)',
        hint: '⌘E',
        run: () => store.setMode(store.mode === 'read' ? 'edit' : 'read'),
      },
      { id: 'switch', title: 'Go to note…', hint: '⌘O', run: () => store.setQuickSwitchOpen(true) },
      { id: 'search', title: 'Search in notes', hint: '⌘⇧F', run: () => store.setSearchOpen(true) },
      { id: 'left', title: 'Toggle file explorer', run: () => store.toggleLeft() },
      { id: 'right', title: 'Toggle right sidebar', run: () => store.toggleRight() },
      { id: 'reload', title: 'Reload vault', run: () => void store.reload() },
      { id: 'open-folder', title: 'Open my own vault folder…', run: () => void store.pickFolder() },
    ],
    [store],
  )

  useEffect(() => {
    if (open) { setQuery(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0) }
  }, [open])

  const filtered = useMemo(
    () => commands.filter((c) => c.title.toLowerCase().includes(query.toLowerCase())),
    [commands, query],
  )
  useEffect(() => setSel(0), [query])
  if (!open) return null

  const choose = (i: number) => {
    const c = filtered[i]
    if (c) { setOpen(false); c.run() }
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="Run a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(sel) }
            else if (e.key === 'Escape') setOpen(false)
          }}
        />
        <div className="modal-list">
          {filtered.length === 0 && <div className="empty-state">No commands.</div>}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`modal-row ${i === sel ? 'selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
            >
              <Command style={{ color: 'var(--text-faint)', flex: '0 0 auto' }} />
              <div className="row-title" style={{ flex: 1 }}>{c.title}</div>
              {c.hint && <div className="row-sub">{c.hint}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
