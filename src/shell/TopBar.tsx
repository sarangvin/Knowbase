import { useVault } from '../vault/vaultStore'
import {
  ArrowLeft, ArrowRight, PanelLeft, PanelRight, Search, Network, Pencil, Eye, Command,
} from '../ui/icons'

export function TopBar() {
  const s = useVault()
  const view = s.activeView()
  const note = view?.kind === 'note' ? s.getNote(view.path) : null
  const crumbs = note ? note.path.replace(/\.md$/i, '').split('/') : []

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" title="Toggle file explorer (⌘\)" onClick={s.toggleLeft}>
          <PanelLeft />
        </button>
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
              <span className={i === crumbs.length - 1 ? 'crumb-current' : 'crumb'}>{c}</span>
            </span>
          ))
        ) : (
          <span className="crumb-current">Home</span>
        )}
      </div>

      <div className="topbar-right">
        <button className="icon-btn" title="Command palette (⌘P)" onClick={() => s.setPaletteOpen(true)}>
          <Command />
        </button>
        <button className="icon-btn" title="Search (⌘⇧F)" onClick={() => s.setSearchOpen(true)}>
          <Search />
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
        <button className="icon-btn" title="Graph view (⌘G)" onClick={() => s.openView({ kind: 'graph' })}>
          <Network />
        </button>
        <button className="icon-btn" title="Toggle right sidebar" onClick={s.toggleRight}>
          <PanelRight />
        </button>
      </div>
    </div>
  )
}
