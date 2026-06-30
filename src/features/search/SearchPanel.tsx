import { useEffect, useMemo, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { Search } from '../../ui/icons'
import './search.css'

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wrap query-term occurrences in <mark>. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t.toLowerCase() === p.toLowerCase()) ? (
          <mark key={i} className="search-hl">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function SearchPanel() {
  const searchNotes = useVault((s) => s.searchNotes)
  const openNote = useVault((s) => s.openNote)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => (query.trim() ? searchNotes(query) : []), [query, searchNotes])
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter((t) => t.length > 1), [query])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    const el = listRef.current?.querySelector('.search-result.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (i: number) => {
    const r = results[i]
    if (r) openNote(r.path)
  }

  return (
    <div className="search-panel">
      <div className="search-input-row">
        <Search />
        <input
          autoFocus
          className="search-input"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(sel) }
          }}
        />
      </div>
      {query.trim() && <div className="search-count">{results.length} result{results.length === 1 ? '' : 's'}</div>}
      <div className="search-results" ref={listRef}>
        {!query.trim() && <div className="empty-state">Type to search across all notes.</div>}
        {query.trim() && results.length === 0 && <div className="empty-state">No matches.</div>}
        {results.map((r, i) => (
          <div
            key={r.path}
            className={`search-result ${i === sel ? 'selected' : ''}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => choose(i)}
          >
            <div className="search-result-title"><Highlight text={r.title} terms={terms} /></div>
            <div className="search-result-snippet"><Highlight text={r.snippet} terms={terms} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
