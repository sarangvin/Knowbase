import { useEffect, useMemo, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { answerQuestion, type LlmProvider } from '../ask-ai/llmProvider'
import { PROVIDERS, getActiveProviderId, setActiveProviderId, getProvider } from '../ask-ai/providerRegistry'
import { getModel, setModel as persistOllamaModel } from '../ask-ai/ollama'
import { bumpLastReviewed } from '../ask-ai/askInsert'
import {
  planSync,
  insertAnswer,
  replaceSection,
  aiNotesPrompt,
  AI_NOTES_SYSTEM,
  type SyncTask,
} from './sync'
import './sync.css'

type TaskStatus = 'pending' | 'running' | 'done' | 'error'

export function SyncModal({ onClose }: { onClose: () => void }) {
  const index = useVault((s) => s.index)
  const getNote = useVault((s) => s.getNote)
  const saveNote = useVault((s) => s.saveNote)

  const [providerId, setProviderId] = useState<LlmProvider['id']>(getActiveProviderId())
  const provider = getProvider(providerId)

  const [readiness, setReadiness] = useState<'checking' | 'ready' | 'not-ready'>('checking')
  const [readyMessage, setReadyMessage] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState(getModel())
  const [statuses, setStatuses] = useState<Record<number, TaskStatus>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [phase, setPhase] = useState<'idle' | 'running' | 'finished'>('idle')

  // Plan once per open (fresh notes each time the modal mounts).
  const tasks = useMemo<SyncTask[]>(
    () => (index ? planSync([...index.notes.values()]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const checkReadiness = () => {
    setReadiness('checking')
    const p = getProvider(providerId)
    const check = p.checkReady ? p.checkReady() : Promise.resolve<{ ready: boolean; message?: string }>({ ready: true })
    check.then(({ ready, message }) => {
      setReadiness(ready ? 'ready' : 'not-ready')
      setReadyMessage(message ?? null)
      if (ready && p.listModels) {
        p.listModels()
          .then((names) => {
            setModels(names)
            setModel((m) => {
              const next = m && names.includes(m) ? m : (names[0] ?? '')
              if (next) persistOllamaModel(next)
              return next
            })
          })
          .catch(() => setModels([]))
      } else {
        setModels([])
      }
    })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(checkReadiness, [providerId])

  const selectProvider = (id: string) => {
    setActiveProviderId(id as LlmProvider['id'])
    setProviderId(id as LlmProvider['id'])
  }

  const run = async () => {
    if (phase === 'running') return
    setPhase('running')
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]
      setStatuses((s) => ({ ...s, [i]: 'running' }))
      try {
        // Re-read the note each time: an earlier task may have rewritten it.
        const note = getNote(t.path)
        if (!note) throw new Error('note disappeared')
        let raw: string
        if (t.kind === 'question') {
          const answer = await answerQuestion(provider, note, t.question!, model)
          raw = insertAnswer(note.raw, t.question!, answer)
        } else {
          const body = await provider.streamChat(AI_NOTES_SYSTEM, aiNotesPrompt(note), { model })
          raw = replaceSection(note.raw, 'AI Notes', body)
        }
        await saveNote(t.path, bumpLastReviewed(raw))
        setStatuses((s) => ({ ...s, [i]: 'done' }))
      } catch (e) {
        setStatuses((s) => ({ ...s, [i]: 'error' }))
        setErrors((er) => ({ ...er, [i]: e instanceof Error ? e.message : String(e) }))
      }
    }
    setPhase('finished')
  }

  const doneCount = Object.values(statuses).filter((s) => s === 'done').length

  const providerPicker = (
    <select
      className="ask-model"
      value={providerId}
      disabled={phase === 'running'}
      onChange={(e) => selectProvider(e.target.value)}
      title="AI provider"
    >
      {PROVIDERS.map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  )

  return (
    <div className="modal-overlay" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span className="sync-title">AI Sync</span>
          {providerPicker}
          {readiness === 'ready' && models.length > 0 && (
            <select
              className="ask-model"
              value={model}
              disabled={phase === 'running'}
              onChange={(e) => { setModel(e.target.value); persistOllamaModel(e.target.value) }}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
        <p className="sync-sub">
          Answers open questions and folds your “My Notes” into “AI Notes” across the vault —
          the in-app version of <code>sync-knowledge-notes</code>.
        </p>

        {readiness === 'checking' && (
          <div className="sync-empty"><span className="spinner ask-spin" /> Connecting…</div>
        )}

        {readiness === 'not-ready' && (
          <div className="sync-empty">
            <p>{readyMessage ?? 'This provider is not available right now.'}</p>
            <button className="ask-btn" onClick={checkReadiness}>Retry</button>
          </div>
        )}

        {readiness === 'ready' && tasks.length === 0 && (
          <div className="sync-empty">
            Nothing to sync — no unanswered <code>Q:</code> entries and no “My Notes” content
            found. Add a question to a note's <code>## Questions</code> section or jot thoughts
            under <code>## My Notes</code>, then run this again.
          </div>
        )}

        {readiness === 'ready' && tasks.length > 0 && (
          <div className="sync-list">
            {tasks.map((t, i) => (
              <div key={i} className={`sync-item ${statuses[i] ?? 'pending'}`}>
                <span className="sync-item-status">
                  {statuses[i] === 'running' ? <span className="spinner ask-spin" /> :
                    statuses[i] === 'done' ? '✓' :
                    statuses[i] === 'error' ? '✕' : '·'}
                </span>
                <span className="sync-item-note">{t.title}</span>
                <span className="sync-item-label" title={errors[i] ?? t.label}>
                  {statuses[i] === 'error' ? errors[i] : t.label}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="sync-foot">
          {phase === 'finished' && (
            <span className="sync-done-msg">✓ {doneCount}/{tasks.length} updated</span>
          )}
          <button className="ask-btn" onClick={onClose} disabled={phase === 'running'}>
            {phase === 'finished' ? 'Close' : 'Cancel'}
          </button>
          {readiness === 'ready' && tasks.length > 0 && phase !== 'finished' && (
            <button className="ask-btn primary" onClick={() => void run()} disabled={phase === 'running'}>
              {phase === 'running' ? 'Syncing…' : `Run ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
