import { useVault } from '../vault/vaultStore'
import { NoteView } from '../features/reader/NoteView'
import { GraphView } from '../features/graph/GraphView'
import { FileExplorer } from '../features/explorer/FileExplorer'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { QuizView } from '../features/quiz/QuizView'
import { SearchPanel } from '../features/search/SearchPanel'
import { AskPanel } from '../features/ask-ai/AskPanel'
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
  // Files is a destination now rather than a docked sidebar, so the explorer
  // renders as a full pane. Same component — it was never sidebar-specific.
  if (view.kind === 'files') return <div className="files-pane"><FileExplorer /></div>
  if (view.kind === 'quiz') return <QuizView />
  // Search and Ask were panels in a docked right column. They are the only
  // two of the five that earned their space, so they became destinations
  // rather than being deleted with it — and a full pane suits both far
  // better than a 290px strip, especially on a phone.
  if (view.kind === 'search') return <div className="side-pane"><SearchPanel /></div>
  if (view.kind === 'ask') return <div className="side-pane"><AskPanel /></div>
  if (view.kind === 'settings') return <SettingsPanel />
  return <HomeView />
}
