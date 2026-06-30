import { useEffect, useState, type ReactElement } from 'react'
import { useVault } from '../vault/vaultStore'
import { BacklinksPanel } from '../features/backlinks/BacklinksPanel'
import { OutlinePanel } from '../features/backlinks/OutlinePanel'
import { SearchPanel } from '../features/search/SearchPanel'
import { GraphView } from '../features/graph/GraphView'
import { AskPanel } from '../features/ask-ai/AskPanel'
import { LinkIcon, List, Search, Network, Sparkles } from '../ui/icons'

type RTab = 'backlinks' | 'outline' | 'search' | 'graph' | 'ask'

export function RightSidebar() {
  const view = useVault((s) => s.activeView())
  const searchOpen = useVault((s) => s.searchOpen)
  const [tab, setTab] = useState<RTab>('backlinks')
  const notePath = view?.kind === 'note' ? view.path : null

  useEffect(() => {
    if (searchOpen) setTab('search')
  }, [searchOpen])

  const tabs: { id: RTab; icon: ReactElement; title: string }[] = [
    { id: 'backlinks', icon: <LinkIcon />, title: 'Backlinks' },
    { id: 'outline', icon: <List />, title: 'Outline' },
    { id: 'graph', icon: <Network />, title: 'Local graph' },
    { id: 'search', icon: <Search />, title: 'Search' },
    { id: 'ask', icon: <Sparkles />, title: 'Ask AI' },
  ]

  return (
    <div className="right-sidebar">
      <div className="right-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`icon-btn ${tab === t.id ? 'active' : ''}`}
            title={t.title}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="right-content">
        {tab === 'ask' ? (
          <AskPanel />
        ) : tab === 'search' ? (
          <SearchPanel />
        ) : !notePath ? (
          <div className="empty-state">Open a note to see {tab}.</div>
        ) : tab === 'backlinks' ? (
          <BacklinksPanel notePath={notePath} />
        ) : tab === 'outline' ? (
          <OutlinePanel notePath={notePath} />
        ) : (
          <GraphView focusPath={notePath} compact />
        )}
      </div>
    </div>
  )
}
