import { useEffect, useState } from 'react'
import { useVault } from './vault/vaultStore'
import { RemoteVaultSource } from './vault/remoteSource'
import { useKeybindings } from './ui/useKeybindings'
import { registerAutomatedGraph } from './features/automated-graph/register'
import { Onboarding } from './features/onboarding/Onboarding'
import { TopicOnboarding } from './features/onboarding/TopicOnboarding'
import { TopBar } from './shell/TopBar'
import { TabBar } from './shell/TabBar'
import { MainPane } from './shell/MainPane'
import { RightSidebar } from './shell/RightSidebar'
import { BottomNav } from './shell/BottomNav'
import { CommandPalette } from './features/palette/CommandPalette'
import { QuickSwitcher } from './features/palette/QuickSwitcher'
import './App.css'

// Register native dashboard renderers (Dataview replacement) once.
registerAutomatedGraph()

const MOBILE_QUERY = '(max-width: 768px)'

export default function App() {
  const status = useVault((s) => s.status)
  const rightOpen = useVault((s) => s.rightOpen)
  const tryRestoreFolder = useVault((s) => s.tryRestoreFolder)
  const checkAuth = useVault((s) => s.checkAuth)
  const source = useVault((s) => s.source)
  const files = useVault((s) => s.files)
  const loadRemote = useVault((s) => s.loadRemote)
  const [topicOnboardingSkipped, setTopicOnboardingSkipped] = useState(false)
  // True until we know whether this visit resumes an existing session. Without
  // it the landing screen paints for the length of an /auth/me round-trip and
  // is then yanked away, which reads as a flash of "signed out" to someone who
  // never signed out.
  const [booting, setBooting] = useState(true)
  useKeybindings()

  // On boot: resume whatever the visitor already had. A previously-opened
  // local folder wins (it was an explicit choice and needs no network), then
  // a signed-in, approved account goes straight to its cloud vault.
  //
  // Making a returning user pick their vault from a menu on every single
  // visit is a toll for something they never changed. They only see the
  // landing screen when there is genuinely a decision to make: no session, or
  // an account still waiting on approval.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const restored = await tryRestoreFolder()
        await checkAuth()
        if (cancelled) return
        // Re-read from the store rather than closing over props: both calls
        // above are async and the values captured at mount are stale by now.
        const { user, source: current } = useVault.getState()
        if (restored || current) return
        if (user?.accessApproved) await loadRemote()
      } catch {
        // Any failure here just means we fall through to the landing screen,
        // which is a working state — never a dead spinner.
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
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
      useVault.setState({ rightOpen: !isMobile })
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

  // Hold the splash while auto-resume is still deciding. Onboarding draws its
  // own spinner once a vault is actually loading, so this only covers the gap
  // before that starts.
  if (booting && status !== 'ready') {
    return (
      <div className="onboarding">
        <div className="spinner" />
      </div>
    )
  }
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

  const closeDrawers = () => useVault.setState({ rightOpen: false })

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        {rightOpen && <div className="drawer-backdrop" onClick={closeDrawers} />}
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
      <BottomNav />
      <CommandPalette />
      <QuickSwitcher />
    </div>
  )
}
