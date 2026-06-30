import { useVault } from '../../vault/vaultStore'
import { backlinksOf } from '../../vault/graph'
import './backlinks.css'

/** Short snippet of the linking note's text around the first mention. */
function contextSnippet(body: string, targetName: string): string | null {
  const re = new RegExp(`\\[\\[\\s*${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*\\]\\]`, 'i')
  const m = body.match(re)
  if (!m || m.index == null) return null
  const start = Math.max(0, m.index - 60)
  const end = Math.min(body.length, m.index + m[0].length + 60)
  return (start > 0 ? '…' : '') + body.slice(start, end).replace(/\n+/g, ' ').trim() + '…'
}

export function BacklinksPanel({ notePath }: { notePath: string }) {
  const index = useVault((s) => s.index)
  const openNote = useVault((s) => s.openNote)
  const getNote = useVault((s) => s.getNote)
  const target = getNote(notePath)
  if (!index || !target) return null

  const sources = backlinksOf(index, notePath)
  const unlinkedMentions: string[] = [] // (reserved for future: text mentions w/o links)

  return (
    <div className="backlinks">
      <div className="panel-header">
        Linked mentions <span className="count">{sources.length}</span>
      </div>
      {sources.length === 0 ? (
        <div className="empty-state">No backlinks yet.</div>
      ) : (
        <div className="backlink-list">
          {sources.map((src) => {
            const note = getNote(src)
            if (!note) return null
            const snippet = contextSnippet(note.body, target.name)
            return (
              <div key={src} className="backlink-item" onClick={() => openNote(src)}>
                <div className="backlink-title">{note.title}</div>
                {snippet && <div className="backlink-snippet">{snippet}</div>}
              </div>
            )
          })}
        </div>
      )}
      {unlinkedMentions.length > 0 && null}
    </div>
  )
}
