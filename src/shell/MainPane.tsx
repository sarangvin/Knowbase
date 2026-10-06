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
import { CollectionSuggestion } from '../features/onboarding/CollectionSuggestion'
import { listSpaces, isArchived, isPending, computeNextUp } from '../features/automated-graph/engine'
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
    // `pending` is the queue's own flag for "this body is still a stub", the
    // same one Next Up draws "Coming soon" from — so the card and the page
    // agree about what exists to read.
    const written = topics.filter((n) => !isPending(n.frontmatter)).length
    // The note this collection's Next Up page would put at the top — taken
    // from that page's own ranking rather than worked out again here, so the
    // card can never name a different note from the one you find when you
    // open it. Null when nothing is ready (everything reviewed today, or
    // waiting on a prerequisite).
    const pick = index ? computeNextUp(index, space).pick : null
    const next = pick ? { title: pick.title, isReview: !!pick.isReview, pending: pick.pending } : null
    return { total: topics.length, studied, written, next }
  }

  const nextUpOf = (space: string) =>
    notes.find((n) => n.path === `Automated Graph/${space}/Next Up.md`)?.path ?? null

  // Builds worth drawing a card for: still running, or failed and not yet
  // dealt with. A job whose space has already appeared in the vault is
  // dropped — the real card is there, and two cards for one collection is
  // worse than a moment without either.
  // Matched on the topic as well as the space, and loosely: a library start
  // copies the notes in before the job is told which space it produced, so
  // for one poll the vault already holds the collection while the job still
  // has no space — and the grid showed the same collection twice.
  const keyOf = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const spaceKeys = new Set(spaces.map(keyOf))
  const pending = buildingJobs.filter(
    (j) =>
      (j.status === 'running' || (j.status === 'failed' && !j.acknowledged)) &&
      !spaceKeys.has(keyOf(j.space ?? j.topic)),
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
      startedAt={j.startedAt}
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
            {/* The quickest first collection there is: already written, so
                it is ready in seconds where a new topic takes a while to
                build — and someone with nothing yet is exactly who should
                see that. Below the question rather than above it, because
                naming your own subject is still the main way in. */}
            <div className="home-suggestion">
              <CollectionSuggestion
                owned={index ? listSpaces(index) : []}
                building={pending.map((j) => j.space ?? j.topic)}
                title="Or start an existing collection"
              />
            </div>
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
                const { total, studied, written, next } = summary(space)
                return (
                  <CollectionCard
                    key={space}
                    summary={{ space, total, studied, written, next, openPath: nextUpOf(space) }}
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
            {/* Two ways to add a collection, as two separate sections: take one
                that already exists in the library — ready in seconds — or
                name a subject nobody has had written yet. */}
            <div className="collection-new">
              <CollectionSuggestion
                // All of them, archived included: offering back something
                // you set aside is not a suggestion.
                owned={index ? listSpaces(index) : []}
                building={pending.map((j) => j.space ?? j.topic)}
              />
              <TopicLauncher
                title="Start a brand new collection"
                hint="Name any subject and Rabbithole writes it for you — a separate collection, kept apart from the ones above."
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
