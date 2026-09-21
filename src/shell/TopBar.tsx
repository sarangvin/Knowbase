// The chrome above the reader: where you are, and the few things you can do
// from anywhere.
//
// It used to carry six icons. Three were removed because they were not
// earning a permanent place in the one bar visible on every screen:
//
//   Graph — reachable by ⌘G and from the command palette, and largely
//   redundant now that the Learn tab and inline links do the navigating.
//   Command palette — a keyboard affordance with a keyboard shortcut. On a
//   phone, where there is no ⌘P, the Files tab does the same job better.
//   AI Sync — a power tool for hand-written vaults, and its label still
//   advertised Ollama, which no longer exists here. It lives in Settings now.
//
// What is left is what has no other way in: search, Ask AI, and the
// read/edit toggle.
import { useVault } from '../vault/vaultStore'
import { ArrowLeft, ArrowRight, Search, Sparkles, Pencil, Eye } from '../ui/icons'
import { folderLabel } from '../ui/folderLabels'

export function TopBar() {
  const s = useVault()
  const view = s.activeView()
  const note = view?.kind === 'note' ? s.getNote(view.path) : null
  const crumbs = note ? note.path.replace(/\.md$/i, '').split('/') : []

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" disabled={!s.canBack()} title="Back (⌥←)" onClick={s.back}>
          <ArrowLeft />
        </button>
        <button className="icon-btn" disabled={!s.canForward()} title="Forward (⌥→)" onClick={s.forward}>
          <ArrowRight />
        </button>
      </div>

      <div className="topbar-title">
        {view?.kind === 'graph' ? (
          <span className="crumb-current">Graph view</span>
        ) : note ? (
          crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="crumb-sep">/</span>}
              <span className={i === crumbs.length - 1 ? 'crumb-current' : 'crumb'}>
                {i === 0 ? folderLabel(c) : c}
              </span>
            </span>
          ))
        ) : (
          <span className="crumb-current">Home</span>
        )}
      </div>

      <div className="topbar-right">
        <button className="icon-btn" title="Search (⌘⇧F)" onClick={() => s.openView({ kind: 'search' })}>
          <Search />
        </button>
        <button className="icon-btn" title="Ask AI" onClick={() => s.openView({ kind: 'ask' })}>
          <Sparkles />
        </button>
        {view?.kind === 'note' && (
          <button
            className={`icon-btn ${s.mode === 'edit' ? 'active' : ''}`}
            title={s.mode === 'read' ? 'Edit (⌘E)' : 'Reading view (⌘E)'}
            onClick={() => s.setMode(s.mode === 'read' ? 'edit' : 'read')}
          >
            {s.mode === 'read' ? <Pencil /> : <Eye />}
          </button>
        )}
      </div>
    </div>
  )
}
