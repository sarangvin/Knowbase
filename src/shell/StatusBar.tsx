import { useVault } from '../vault/vaultStore'

export function StatusBar() {
  const index = useVault((s) => s.index)
  const view = useVault((s) => s.activeView())
  const getNote = useVault((s) => s.getNote)
  const sourceKind = useVault((s) => s.source?.kind)
  const note = view?.kind === 'note' ? getNote(view.path) : null

  const noteCount = index?.notes.size ?? 0
  const words = note ? note.body.trim().split(/\s+/).filter(Boolean).length : null
  const backlinks = note ? index?.backlinks.get(note.path)?.size ?? 0 : null

  return (
    <div className="statusbar">
      <span>{noteCount} notes</span>
      {words != null && <span>{words} words</span>}
      {backlinks != null && <span>{backlinks} backlinks</span>}
      <span style={{ marginLeft: 'auto' }}>
        {sourceKind === 'seed' ? 'Demo · saved in browser' : 'Editable vault'}
      </span>
    </div>
  )
}
