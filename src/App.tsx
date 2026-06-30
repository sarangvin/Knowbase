import { useEffect } from 'react'
import { useVault } from './vault/vaultStore'
import { useKeybindings } from './ui/useKeybindings'
import { registerAutomatedGraph } from './features/automated-graph/register'
import { Onboarding } from './features/onboarding/Onboarding'
import { FileExplorer } from './features/explorer/FileExplorer'
import { TopBar } from './shell/TopBar'
import { TabBar } from './shell/TabBar'
import { MainPane } from './shell/MainPane'
import { RightSidebar } from './shell/RightSidebar'
import { StatusBar } from './shell/StatusBar'
import { CommandPalette } from './features/palette/CommandPalette'
import { QuickSwitcher } from './features/palette/QuickSwitcher'
import './App.css'

// Register native dashboard renderers (Dataview replacement) once.
registerAutomatedGraph()

export default function App() {
  const status = useVault((s) => s.status)
  const leftOpen = useVault((s) => s.leftOpen)
  const rightOpen = useVault((s) => s.rightOpen)
  const tryRestoreFolder = useVault((s) => s.tryRestoreFolder)
  useKeybindings()

  // On boot: try to restore a previously-opened folder; otherwise the
  // onboarding screen lets the user pick the demo vault or their own folder.
  useEffect(() => {
    void tryRestoreFolder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status !== 'ready') return <Onboarding />

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <aside className={`left-sidebar ${leftOpen ? '' : 'collapsed'}`}>
          <FileExplorer />
        </aside>
        <main className="main">
          <TabBar />
          <div className="main-content">
            <MainPane />
          </div>
        </main>
        <aside className={`right-sidebar-wrap ${rightOpen ? '' : 'collapsed'}`}>
          <RightSidebar />
        </aside>
      </div>
      <StatusBar />
      <CommandPalette />
      <QuickSwitcher />
    </div>
  )
}
