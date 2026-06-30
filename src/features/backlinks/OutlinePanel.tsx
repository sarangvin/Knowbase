import { useVault } from '../../vault/vaultStore'
import './backlinks.css'

export function OutlinePanel({ notePath }: { notePath: string }) {
  const note = useVault((s) => s.getNote(notePath))
  const openNote = useVault((s) => s.openNote)
  if (!note) return null
  if (note.headings.length === 0)
    return (
      <div className="outline">
        <div className="panel-header">Outline</div>
        <div className="empty-state">No headings.</div>
      </div>
    )
  const minLevel = Math.min(...note.headings.map((h) => h.level))
  return (
    <div className="outline">
      <div className="panel-header">Outline</div>
      <div className="outline-list">
        {note.headings.map((h, i) => (
          <div
            key={i}
            className="outline-item"
            style={{ paddingLeft: 10 + (h.level - minLevel) * 14 }}
            onClick={() => openNote(notePath, { heading: h.text })}
          >
            {h.text}
          </div>
        ))}
      </div>
    </div>
  )
}
