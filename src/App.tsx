import { useEffect, useState } from 'react'
import { useVault } from './vault/vaultStore'
import { useKeybindings } from './ui/useKeybindings'
import { registerAutomatedGraph } from './features/automated-graph/register'
import { Onboarding } from './features/onboarding/Onboarding'
import { OnboardingBanner } from './features/onboarding/OnboardingBanner'
import { takePendingTopic, clearPendingTopic } from './features/onboarding/pendingTopic'
import { resetDemoOverlay } from './vault/source'
import { listSpaces } from './features/automated-graph/engine'
import { startOnboarding, fetchOnboardingJob } from './features/onboarding/onboardingApi'
import { TopBar } from './shell/TopBar'
import { TabBar } from './shell/TabBar'
import { MainPane } from './shell/MainPane'
import { BottomNav } from './shell/BottomNav'
import { CommandPalette } from './features/palette/CommandPalette'
import { QuickSwitcher } from './features/palette/QuickSwitcher'
import './App.css'

// Register native dashboard renderers (Dataview replacement) once.
registerAutomatedGraph()


/** Path-based rather than a query flag so the URL is something you can hand
 *  to someone: rabbithole-topaz.vercel.app/demo. Trailing slash tolerated
 *  because that is how people type and how some hosts normalise. */
function isDemoRoute(): boolean {
  return /^\/demo\/?$/.test(location.pathname)
}

export default function App() {
  const status = useVault((s) => s.status)
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

        // While a space is being generated there is nothing of theirs to show
        // — for a first run. For anyone who already has collections that is
        // simply false, and loading the demo threw them out of their own
        // vault on every reload until the job finished. Show the demo only
        // when their vault really is empty.
        const openOwnVaultOrDemo = async (generating: boolean) => {
          await loadRemote()
          if (!generating) return
          // loadFromSource records a failure as status 'error' rather than
          // throwing, so a vault that would not load has to be checked for,
          // not caught — and for a first run it is the demo that should win
          // over a broken empty pane.
          const { index, status } = useVault.getState()
          if (status === 'ready' && index && listSpaces(index).length > 0) return
          await loadSeed()
        }

        const restored = await tryRestoreFolder()
        await checkAuth()
        if (cancelled) return
        // Re-read from the store rather than closing over props: both calls
        // above are async and the values captured at mount are stale by now.
        const { user, source: current } = useVault.getState()
        if (restored || current) return
        if (!user?.accessApproved) return

        // The job comes first, because the server may already have started
        // one. Approving a waitlisted account now kicks off the topic they
        // gave before they knew they were waiting — so by the time they get
        // here the work is underway, and consuming the stale handoff would
        // generate the same space a second time at six model calls a go.
        const job = await fetchOnboardingJob()
        if (job) {
          clearPendingTopic()
          await openOwnVaultOrDemo(job.status === 'running')
          return
        }

        // No job: a topic typed before sign-in, carried across the OAuth
        // round-trip, is the thing to act on.
        const pending = takePendingTopic()
        if (pending) {
          try {
            await startOnboarding(pending)
            await openOwnVaultOrDemo(true)
          } catch {
            // Couldn't start it — fall through to the landing screen, where
            // the input is pre-filled with what they typed, rather than into
            // an empty vault that explains nothing.
          }
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


  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <main className="main">
          <TabBar />
          <div className="main-content">
            <MainPane />
          </div>
        </main>
      </div>
      <BottomNav />
      <OnboardingBanner />
      <CommandPalette />
      <QuickSwitcher />
    </div>
  )
}
