import { useEffect, useState } from 'react'
import { useVault } from './vault/vaultStore'
import { useKeybindings } from './ui/useKeybindings'
import { registerAutomatedGraph } from './features/automated-graph/register'
import { Onboarding } from './features/onboarding/Onboarding'
import { OnboardingBanner } from './features/onboarding/OnboardingBanner'
import { takePendingTopic } from './features/onboarding/pendingTopic'
import { resetDemoOverlay } from './vault/source'
import { startOnboarding, fetchOnboardingJob } from './features/onboarding/onboardingApi'
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

/** Path-based rather than a query flag so the URL is something you can hand
 *  to someone: rabbithole-topaz.vercel.app/demo. Trailing slash tolerated
 *  because that is how people type and how some hosts normalise. */
function isDemoRoute(): boolean {
  return /^\/demo\/?$/.test(location.pathname)
}

export default function App() {
  const status = useVault((s) => s.status)
  const rightOpen = useVault((s) => s.rightOpen)
  const tryRestoreFolder = useVault((s) => s.tryRestoreFolder)
  const checkAuth = useVault((s) => s.checkAuth)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadSeed = useVault((s) => s.loadSeed)
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
        // /demo — see the app exactly as a first-time visitor does, whoever
        // is signed in. Deliberately the first thing checked and an early
        // return: every branch below this is "resume what this person
        // already had", which is precisely what makes the new-user
        // experience impossible to look at once you have an account.
        //
        // No auth, no session check, no network beyond the bundled vault, so
        // it also works for someone with no account at all.
        if (isDemoRoute()) {
          if (new URLSearchParams(location.search).has('reset')) await resetDemoOverlay()
          // Fire-and-forget: a visit counter must never delay or break the
          // thing it is counting.
          void fetch('/api/demo/visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'demo_open' }),
          }).catch(() => {})
          await loadSeed()
          return
        }

        const restored = await tryRestoreFolder()
        await checkAuth()
        if (cancelled) return
        // Re-read from the store rather than closing over props: both calls
        // above are async and the values captured at mount are stale by now.
        const { user, source: current } = useVault.getState()
        if (restored || current) return
        if (!user?.accessApproved) return

        // A topic typed before sign-in, carried across the OAuth round-trip.
        // This is the only place it can be picked up: an approved user never
        // sees the landing screen again, because the resume below takes them
        // straight past it.
        const pending = takePendingTopic()
        if (pending) {
          try {
            await startOnboarding(pending)
            await loadSeed()
          } catch {
            // Couldn't start it — fall through to the landing screen, where
            // they can try again, rather than into an empty vault that
            // explains nothing.
          }
          return
        }

        // Mid-generation, so their own vault is empty or half-written. The
        // demo space is the honest thing to show; the banner brings them
        // across the moment theirs is ready.
        const job = await fetchOnboardingJob()
        if (job?.status === 'running') {
          await loadSeed()
          return
        }
        await loadRemote()
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

  // There is no "brand-new empty vault" gate here any more. It used to catch a
  // user whose personal vault had no notes and ask them for a topic, because
  // that was the only moment the client could generate one. The server does
  // that now, started from the landing screen, so an empty vault at this point
  // means the space is still being written — which OnboardingBanner says, from
  // wherever the user happens to be.

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
      <OnboardingBanner />
      <CommandPalette />
      <QuickSwitcher />
    </div>
  )
}
