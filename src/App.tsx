import { useEffect, useState } from 'react'
import { useVault } from './vault/vaultStore'
import { RemoteVaultSource } from './vault/remoteSource'
import { useKeybindings } from './ui/useKeybindings'
import { registerAutomatedGraph } from './features/automated-graph/register'
import { Onboarding } from './features/onboarding/Onboarding'
import { TopicOnboarding } from './features/onboarding/TopicOnboarding'
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

const MOBILE_QUERY = '(max-width: 768px)'

export default function App() {
  const status = useVault((s) => s.status)
  const leftOpen = useVault((s) => s.leftOpen)
  const rightOpen = useVault((s) => s.rightOpen)
  const tryRestoreFolder = useVault((s) => s.tryRestoreFolder)
  const checkAuth = useVault((s) => s.checkAuth)
  const activeView = useVault((s) => s.activeView())
  const source = useVault((s) => s.source)
  const files = useVault((s) => s.files)
  const [topicOnboardingSkipped, setTopicOnboardingSkipped] = useState(false)
  useKeybindings()

  // On boot: try to restore a previously-opened folder and check for a signed-in
  // Google session; otherwise the onboarding screen lets the user pick the demo
  // vault, sign in for their cloud vault, or open their own local folder.
  useEffect(() => {
    void tryRestoreFolder()
    void checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On narrow viewports both sidebars become full-height overlay drawers (see
  // App.css) instead of fixed-width flex columns — two 250px+290px columns
  // would otherwise squeeze the main content to nothing and put the right
  // sidebar off-screen. React to the breakpoint live (not just once at mount —
  // a mount-only check misses a resize that happens after first paint, e.g.
  // rotating a phone or resizing a desktop window): entering mobile closes
  // both drawers so the note is visible first; leaving mobile back to desktop
  // reopens both, since otherwise the user lands on a full desktop screen with
  // no way back to either panel except manually clicking both toggle buttons.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    let lastIsMobile = mq.matches
    const sync = () => {
      const isMobile = window.matchMedia(MOBILE_QUERY).matches
      lastIsMobile = isMobile
      useVault.setState({ leftOpen: !isMobile, rightOpen: !isMobile })
    }
    sync()
    // Three independent signals, deliberately redundant: matchMedia's 'change'
    // and window 'resize' are the standard, cheap, event-driven path for a
    // real user resizing a real browser window or rotating a phone. Some
    // devtools/CDP-driven viewport overrides, though, change the rendered
    // layout without dispatching either (observed against this app's own
    // preview tooling) — a low-frequency poll is the only mechanism that
    // can't be silently skipped by however the viewport change was triggered.
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    const poll = setInterval(() => {
      if (window.matchMedia(MOBILE_QUERY).matches !== lastIsMobile) sync()
    }, 500)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      clearInterval(poll)
    }
  }, [])

  // Mobile only: picking a note closes the file-drawer automatically so the
  // reading pane is immediately visible, matching Obsidian's mobile behavior.
  useEffect(() => {
    if (activeView?.kind !== 'note') return
    if (!window.matchMedia(MOBILE_QUERY).matches) return
    useVault.setState({ leftOpen: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView?.kind === 'note' ? activeView.path : null])

  if (status !== 'ready') return <Onboarding />

  // A brand-new cloud user (personal vault has zero notes of its own, distinct
  // from the owner's global-edit mode which also returns origin: 'global' for
  // every file) gets a topic prompt instead of landing in a bare empty vault.
  // Not persisted across reloads if skipped — the gate naturally stops firing
  // once they have any personal note.
  const isBrandNewPersonalVault =
    source instanceof RemoteVaultSource &&
    source.mode === 'personal' &&
    files.filter((f) => f.origin === 'personal').length === 0
  if (isBrandNewPersonalVault && !topicOnboardingSkipped) {
    return <TopicOnboarding onSkip={() => setTopicOnboardingSkipped(true)} />
  }

  const closeDrawers = () => useVault.setState({ leftOpen: false, rightOpen: false })

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        {(leftOpen || rightOpen) && <div className="drawer-backdrop" onClick={closeDrawers} />}
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
