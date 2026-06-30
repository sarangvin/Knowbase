import { useVault } from '../vault/vaultStore'
import { NoteView } from '../features/reader/NoteView'
import { GraphView } from '../features/graph/GraphView'
import { GraduationCap, Network } from '../ui/icons'

function HomeView() {
  const index = useVault((s) => s.index)
  const openNote = useVault((s) => s.openNote)
  const openView = useVault((s) => s.openView)
  const sourceName = useVault((s) => s.sourceName)
  const notes = index ? [...index.notes.values()] : []
  const featured = notes
    .filter((n) => /Welcome|Today|README|Claude Projects/i.test(n.name))
    .slice(0, 6)

  return (
    <div className="note-scroll">
      <div className="note-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <GraduationCap width={26} height={26} style={{ color: 'var(--accent)' }} />
          <h1 className="note-title" style={{ margin: 0 }}>{sourceName}</h1>
        </div>
        <p style={{ color: 'var(--text-muted)' }}>
          {notes.length} notes. Open the graph, or jump in below.
        </p>
        <button className="ob-btn" style={{ minWidth: 0 }} onClick={() => openView({ kind: 'graph' })}>
          <Network /> Open graph view
        </button>
        <h3 style={{ marginTop: 28 }}>Start here</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {featured.map((n) => (
            <a key={n.path} className="internal-link" onClick={() => openNote(n.path)}>
              {n.title}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MainPane() {
  const view = useVault((s) => s.activeView())
  if (!view) return <HomeView />
  if (view.kind === 'note') return <NoteView path={view.path} heading={view.heading} />
  if (view.kind === 'graph') return <GraphView />
  return <HomeView />
}
