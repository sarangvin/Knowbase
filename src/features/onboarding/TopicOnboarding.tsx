// Shown instead of the bare empty personal vault for a brand-new cloud user
// (see the gate in App.tsx): ask what they want to learn, generate a small
// starter prerequisite graph via the free LLM tier, write it into their
// vault, and land them on the new space's Next Up dashboard.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { generateLearningPlan, generateTopicNote, type ValidatedPlan } from './topicGeneration'
import { disambiguateSpace, dedupeSegments, buildTopicNote, buildNextUpNote } from './notePlan'
import { takePendingTopic } from './pendingTopic'
import { fetchLibrarySpaces, adoptSpace, contributeToLibrary } from '../../vault/remoteSource'
import { Sparkles } from '../../ui/icons'
import './onboarding.css'

type Stage = 'idle' | 'checking' | 'adopting' | 'generating' | 'drafting' | 'writing' | 'error'

interface PendingWrite {
  entries: { path: string; content: string }[]
  openPath: string
}

export function TopicOnboarding({ onSkip }: { onSkip: () => void }) {
  const index = useVault((s) => s.index)
  const createNotes = useVault((s) => s.createNotes)
  const reload = useVault((s) => s.reload)
  const openNote = useVault((s) => s.openNote)

  const [topic, setTopic] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [pending, setPending] = useState<PendingWrite | null>(null)
  const [drafted, setDrafted] = useState(0)
  const [totalTopics, setTotalTopics] = useState(0)
  // Guards the auto-start below against StrictMode's double-invoked effects
  // and against any later re-render: a pending topic must generate once.
  const autoStarted = useRef(false)

  // Drafts a first-pass body for every subtopic, then assembles the writes.
  // The drafts run in parallel: they're independent, and five sequential
  // round-trips would dominate the wall-clock time of onboarding.
  //
  // generateTopicNote resolves to null instead of rejecting, so a subtopic
  // whose draft fails simply keeps the summary-only body — a partial set of
  // drafted notes is strictly better than failing the whole setup, which is
  // already written and validated by this point.
  const buildEntries = async (plan: ValidatedPlan): Promise<PendingWrite> => {
    const space = disambiguateSpace(plan.space, index)
    const segments = dedupeSegments(plan.subtopics.map((s) => s.title))
    const titles = plan.subtopics.map((s) => s.title)

    setDrafted(0)
    const bodies = await Promise.all(
      plan.subtopics.map((s) =>
        generateTopicNote(space, s, titles).then((body) => {
          setDrafted((n) => n + 1)
          return body
        }),
      ),
    )

    const entries = plan.subtopics.map((s, i) => ({
      path: `Automated Graph/${space}/Topics/${segments[i]}.md`,
      content: buildTopicNote(s.title, s, bodies[i]),
    }))
    const openPath = `Automated Graph/${space}/Next Up.md`
    entries.push({ path: openPath, content: buildNextUpNote(space) })
    return { entries, openPath }
  }

  const runWrite = async (write: PendingWrite) => {
    setStage('writing')
    setErrorMsg('')
    try {
      await createNotes(write.entries, write.openPath)
      // Success: App re-renders the main shell now that `files` has personal entries.
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }

  const runGeneration = async () => {
    // Every in-flight stage must be listed here, not just the first one —
    // Enter is still bound while a run is in progress.
    if (!topic.trim() || isBusy) return
    await runGenerationFor(topic.trim())
  }

  // Takes the topic as an argument rather than reading state: the auto-start
  // effect runs in the same tick as its setTopic, so state would still be ''.
  // Same normalization the server applies to space names, so a hit here is a
  // hit there. Kept deliberately dumb — matching "Kubernetes" to "Kubernetes"
  // is worth doing; guessing that "k8s" means the same thing risks handing
  // someone a space about a different subject.
  const normalizeTopic = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  const runGenerationFor = async (t: string) => {
    setStage('checking')
    setErrorMsg('')
    setPending(null)
    try {
      // Someone may already have written this. Copying their drafts is
      // instant and costs nothing, where generating is ~6 model calls.
      try {
        const spaces = await fetchLibrarySpaces()
        const hit = spaces.find((sp) => sp.key === normalizeTopic(t))
        if (hit) {
          setStage('adopting')
          const { openPath } = await adoptSpace(hit.name)
          // Adoption happens server-side, so the client's index knows nothing
          // about the new notes — re-list from the server rather than calling
          // createNotes with an empty set, which would leave the index stale
          // and then try to open a path it has never heard of.
          await reload()
          openNote(openPath, { replace: true })
          return
        }
      } catch (err) {
        // The corpus is an optimization. If looking it up fails, generate.
        console.warn('[library] lookup failed, generating instead:', err)
      }

      setStage('generating')
      const plan = await generateLearningPlan(t)
      setTotalTopics(plan.subtopics.length)
      setStage('drafting')
      const write = await buildEntries(plan)
      setPending(write)
      await runWrite(write)
      // Contribute the drafts as created, before the user edits anything, so
      // only AI-written content ever leaves their vault. Deliberately not
      // awaited ahead of the user seeing their notes.
      void contributeToLibrary(write.entries)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }

  // The topic was typed on the landing screen before sign-in. Asking for it
  // again here would make the OAuth round-trip feel like it lost their input.
  useEffect(() => {
    if (autoStarted.current) return
    const pending = takePendingTopic()
    if (!pending) return
    autoStarted.current = true
    setTopic(pending)
    void runGenerationFor(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isBusy =
    stage === 'checking' || stage === 'adopting' || stage === 'generating' || stage === 'drafting' || stage === 'writing'

  return (
    <div className="onboarding">
      <div className="ob-card">
        <div className="ob-logo">
          <Sparkles width={30} height={30} />
        </div>
        <h1 className="ob-title">What do you want to learn?</h1>
        <p className="ob-sub">
          Tell us a topic and we'll set up a starter learning space — a handful of subtopics
          with the ones you can start on right away surfaced in Next Up.
        </p>

        {stage === 'error' && <div className="ob-error">{errorMsg}</div>}

        {stage === 'checking' && (
          <div className="ob-actions">
            <p className="ob-note"><span className="spinner" /> Looking for an existing space…</p>
          </div>
        )}
        {stage === 'adopting' && (
          <div className="ob-actions">
            <p className="ob-note"><span className="spinner" /> Found one — copying it into your vault…</p>
          </div>
        )}
        {stage === 'generating' && (
          <div className="ob-actions">
            <p className="ob-note"><span className="spinner" /> Generating your learning plan…</p>
          </div>
        )}
        {stage === 'drafting' && (
          <div className="ob-actions">
            <p className="ob-note">
              <span className="spinner" /> Drafting notes… {drafted}/{totalTopics}
            </p>
          </div>
        )}
        {stage === 'writing' && (
          <div className="ob-actions">
            <p className="ob-note"><span className="spinner" /> Setting up your notes…</p>
          </div>
        )}

        {(stage === 'idle' || stage === 'error') && (
          <div className="ob-actions">
            <input
              className="ob-topic-input"
              autoFocus
              placeholder="e.g. Quantum computing, French cooking, Kubernetes…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runGeneration()}
              disabled={isBusy}
            />
            {stage === 'error' && pending ? (
              <>
                <button className="ob-btn primary" onClick={() => void runWrite(pending)}>
                  Retry
                </button>
                <button className="ob-btn" onClick={() => { setPending(null); void runGeneration() }}>
                  Start over with a new plan
                </button>
              </>
            ) : (
              <button className="ob-btn primary" disabled={!topic.trim()} onClick={() => void runGeneration()}>
                Generate my learning plan
              </button>
            )}
          </div>
        )}

        <p className="ob-note" style={{ marginTop: 16 }}>
          <button className="ob-linklike" onClick={onSkip} disabled={isBusy}>
            Skip for now — start with an empty vault
          </button>
        </p>
      </div>
    </div>
  )
}
