import { useState } from 'react'
import { useVault } from '../vault/vaultStore'
import { NoteView } from '../features/reader/NoteView'
import { GraphView } from '../features/graph/GraphView'
import { FilesPane } from '../features/explorer/FilesPane'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { QuizView } from '../features/quiz/QuizView'
import { FlashcardsView } from '../features/flashcards/FlashcardsView'
import { SearchPanel } from '../features/search/SearchPanel'
import { TopicLauncher } from '../features/onboarding/TopicLauncher'
import { listSpaces, isArchived } from '../features/automated-graph/engine'
import { CollectionCard, BuildingCard } from '../features/automated-graph/CollectionCard'
import { startOnboarding } from '../features/onboarding/onboardingApi'
import { RabbitSolid } from '../ui/icons'

function HomeView() {
  const index = useVault((s) => s.index)
  const reload = useVault((s) => s.reload)
  const buildingJobs = useVault((s) => s.buildingJobs)
  const [retrying, setRetrying] = useState<string | null>(null)
  const notes = index ? [...index.notes.values()] : []

  // A "collection" is a generated space: Automated Graph/<Space>/Topics/…
  // Nobody should be limited to one subject, so the home screen is a list of
  // them plus a way to add another, rather than a single vault landing page.
  //
  // Archived ones are not here. They still exist, and Settings lists them —
  // "set aside" has to mean something on the screen it was set aside from.
  const spaces = index ? listSpaces(index).filter((s) => !isArchived(index, s)) : []
  const archivedCount = index ? listSpaces(index).length - spaces.length : 0

  const summary = (space: string) => {
    const topics = notes.filter((n) => n.path.startsWith(`Automated Graph/${space}/Topics/`))
    const studied = topics.filter((n) => !!n.frontmatter.last_reviewed).length
    return { total: topics.length, studied }
  }

  const nextUpOf = (space: string) =>
    notes.find((n) => n.path === `Automated Graph/${space}/Next Up.md`)?.path ?? null

  // Builds worth drawing a card for: still running, or failed and not yet
  // dealt with. A job whose space has already appeared in the vault is
  // dropped — the real card is there, and two cards for one collection is
  // worse than a moment without either.
  const pending = buildingJobs.filter(
    (j) =>
      (j.status === 'running' || (j.status === 'failed' && !j.acknowledged)) &&
      !(j.space && spaces.includes(j.space)),
  )

  const retry = async (topic: string) => {
    setRetrying(topic)
    try {
      await startOnboarding(topic)
    } catch {
      // The card keeps showing the original failure, which is still true.
    } finally {
      setRetrying(null)
    }
  }

  const buildingCards = pending.map((j) => (
    <BuildingCard
      key={j.topic}
      topic={j.space ?? j.topic}
      drafted={j.notesDrafted}
      total={j.notesTotal}
      error={j.status === 'failed' ? (j.error ?? 'Something went wrong on our side.') : null}
      busy={retrying === j.topic}
      onRetry={() => void retry(j.topic)}
    />
  ))

  return (
    <div className="note-scroll">
      <div className="note-container">
        {spaces.length === 0 && pending.length === 0 ? (
          // An empty vault used to render "0 notes" and a graph button, which
          // is a dead end — most often reached right after resetting an
          // account. Ask the question that actually moves them forward.
          <div className="home-empty">
            <div className="ob-logo home-logo"><RabbitSolid width={30} height={30} /></div>
            <TopicLauncher
              title="What do you want to learn?"
              hint="Name a topic and Rabbithole digs the tunnels — the subtopics worth knowing, what to study in what order, and a first draft of notes for each."
            />
            {/* Without this, archiving your last collection drops you on the
                first-run screen with no sign your notes still exist. */}
            {archivedCount > 0 && (
              <p className="home-archived-note">
                You have {archivedCount} archived collection{archivedCount === 1 ? '' : 's'} — bring
                them back in Settings.
              </p>
            )}
          </div>
        ) : (
          <>
            <h1 className="note-title">Your collections</h1>
            <p className="home-sub">
              {spaces.length} collection{spaces.length === 1 ? '' : 's'}
              {pending.length > 0 && `, ${pending.length} being built`}. Each one is its own
              subject, with its own order of study.
            </p>
            <div className="collection-grid">
              {buildingCards}
              {spaces.map((space) => {
                const { total, studied } = summary(space)
                return (
                  <CollectionCard
                    key={space}
                    summary={{ space, total, studied, openPath: nextUpOf(space) }}
                    onChanged={() => void reload()}
                  />
                )
              })}
            </div>
            {archivedCount > 0 && (
              <p className="home-archived-note">
                {archivedCount} archived collection{archivedCount === 1 ? '' : 's'} — bring them back
                in Settings.
              </p>
            )}
            <div className="collection-new">
              <TopicLauncher
                title="Start another collection"
                hint="A separate subject, kept apart from the ones above."
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function MainPane() {
  const view = useVault((s) => s.activeView())
  if (!view) return <HomeView />
  if (view.kind === 'note') return <NoteView path={view.path} heading={view.heading} />
  if (view.kind === 'graph') return <GraphView />
  // Files is a destination rather than a docked sidebar, and it opens on the
  // graph: the tree is two machine-named folders with everything of interest
  // three levels down, which is a poor answer to "what is in here". The pane
  // owns the switch between the two.
  if (view.kind === 'files') return <FilesPane />
  if (view.kind === 'quiz') return <QuizView />
  if (view.kind === 'flashcards') return <FlashcardsView />
  // Search and Ask were panels in a docked right column. They are the only
  // two of the five that earned their space, so they became destinations
  // rather than being deleted with it — and a full pane suits both far
  // better than a 290px strip, especially on a phone.
  if (view.kind === 'search') return <div className="side-pane"><SearchPanel /></div>
  if (view.kind === 'settings') return <SettingsPanel />
  return <HomeView />
}
