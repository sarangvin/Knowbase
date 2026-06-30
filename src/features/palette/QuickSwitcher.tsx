// Quick switcher (⌘O / Ctrl-O): fuzzy-open any note by name. Functional now;
// the workflow may add fuzzy ranking + recent-files. Self-contained modal driven
// by store.quickSwitchOpen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { FileText } from '../../ui/icons'

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 1
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak++
      score += streak
      qi++
    } else streak = 0
  }
  return qi === q.length ? score + (t.startsWith(q) ? 50 : 0) : -1
}

export function QuickSwitcher() {
  const open = useVault((s) => s.quickSwitchOpen)
  const setOpen = useVault((s) => s.setQuickSwitchOpen)
  const index = useVault((s) => s.index)
  const openNote = useVault((s) => s.openNote)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const results = useMemo(() => {
    if (!index) return []
    const notes = [...index.notes.values()]
    if (!query.trim())
      return notes.slice(0, 50).map((n) => ({ note: n, score: 0 }))
    return notes
      .map((n) => ({ note: n, score: Math.max(fuzzyScore(query, n.name), fuzzyScore(query, n.title)) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
  }, [query, index])

  useEffect(() => setSel(0), [query])
  if (!open) return null

  const choose = (i: number) => {
    const r = results[i]
    if (r) {
      openNote(r.note.path)
      setOpen(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="Go to note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(sel) }
            else if (e.key === 'Escape') setOpen(false)
          }}
        />
        <div className="modal-list">
          {results.length === 0 && <div className="empty-state">No notes found.</div>}
          {results.map((r, i) => (
            <div
              key={r.note.path}
              className={`modal-row ${i === sel ? 'selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
            >
              <FileText style={{ color: 'var(--text-faint)', flex: '0 0 auto' }} />
              <div style={{ overflow: 'hidden' }}>
                <div className="row-title">{r.note.title}</div>
                <div className="row-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.note.path}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
