// Shown instead of the bare empty personal vault for a brand-new cloud user
// (see the gate in App.tsx): ask what they want to learn, generate a small
// starter prerequisite graph via the free LLM tier, write it into their
// vault, and land them on the new space's Next Up dashboard.
import { useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { generateLearningPlan, type ValidatedPlan } from './topicGeneration'
import { disambiguateSpace, dedupeSegments, buildTopicNote, buildNextUpNote } from './notePlan'
import { Sparkles } from '../../ui/icons'
import './onboarding.css'

type Stage = 'idle' | 'generating' | 'writing' | 'error'

interface PendingWrite {
  entries: { path: string; content: string }[]
  openPath: string
}

export function TopicOnboarding({ onSkip }: { onSkip: () => void }) {
  const index = useVault((s) => s.index)
  const createNotes = useVault((s) => s.createNotes)

  const [topic, setTopic] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [pending, setPending] = useState<PendingWrite | null>(null)

  const buildEntries = (plan: ValidatedPlan): PendingWrite => {
    const space = disambiguateSpace(plan.space, index)
    const segments = dedupeSegments(plan.subtopics.map((s) => s.title))
    const entries = plan.subtopics.map((s, i) => ({
      path: `Automated Graph/${space}/Topics/${segments[i]}.md`,
      content: buildTopicNote(s.title, s),
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
    if (!topic.trim() || stage === 'generating' || stage === 'writing') return
    setStage('generating')
    setErrorMsg('')
    setPending(null)
    try {
      const plan = await generateLearningPlan(topic.trim())
      const write = buildEntries(plan)
      setPending(write)
      await runWrite(write)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }

  const isBusy = stage === 'generating' || stage === 'writing'

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

        {stage === 'generating' && (
          <div className="ob-actions">
            <p className="ob-note"><span className="spinner" /> Generating your learning plan…</p>
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
