import type { ReactElement } from 'react'
import { useVault } from '../vault/vaultStore'
import type { Tab, View } from '../vault/vaultStore'
import { X, Plus, FileText, Network, Home } from '../ui/icons'

function tabLabel(view: View | undefined, getName: (p: string) => string): { label: string; icon: ReactElement } {
  if (!view) return { label: 'New tab', icon: <Home /> }
  if (view.kind === 'graph') return { label: 'Graph', icon: <Network /> }
  if (view.kind === 'note') return { label: getName(view.path), icon: <FileText /> }
  return { label: 'Home', icon: <Home /> }
}

export function TabBar() {
  const tabs = useVault((s) => s.tabs)
  const activeId = useVault((s) => s.activeTabId)
  const setActive = useVault((s) => s.setActiveTab)
  const closeTab = useVault((s) => s.closeTab)
  const newTab = useVault((s) => s.newTab)
  const getNote = useVault((s) => s.getNote)

  const nameOf = (p: string) => getNote(p)?.title ?? p.split('/').pop()?.replace(/\.md$/i, '') ?? p

  if (tabs.length <= 1) return null // no tab strip for a single tab (cleaner)

  return (
    <div className="tabbar">
      {tabs.map((t: Tab) => {
        const { label, icon } = tabLabel(t.history[t.pos], nameOf)
        return (
          <div
            key={t.id}
            className={`tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setActive(t.id)}
            title={label}
          >
            <span className="tab-icon">{icon}</span>
            <span className="tab-label">{label}</span>
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
            >
              <X width={13} height={13} />
            </button>
          </div>
        )
      })}
      <button className="icon-btn tab-new" title="New tab" onClick={newTab}>
        <Plus />
      </button>
    </div>
  )
}
