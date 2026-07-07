import { useEffect, useMemo, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { listModels, getModel, setModel, answerQuestion, chat } from '../ask-ai/ollama'
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

  const [conn, setConn] = useState<'checking' | 'ready' | 'down'>('checking')
  const [models, setModels] = useState<string[]>([])
  const [model, setModelState] = useState(getModel())
  const [statuses, setStatuses] = useState<Record<number, TaskStatus>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [phase, setPhase] = useState<'idle' | 'running' | 'finished'>('idle')

  // Plan once per open (fresh notes each time the modal mounts).
  const tasks = useMemo<SyncTask[]>(
    () => (index ? planSync([...index.notes.values()]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    listModels()
      .then((names) => {
        setModels(names)
        setConn('ready')
        setModelState((m) => {
          const next = m && names.includes(m) ? m : (names[0] ?? '')
          if (next) setModel(next)
          return next
        })
      })
      .catch(() => setConn('down'))
  }, [])

  const run = async () => {
    if (!model || phase === 'running') return
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
          const answer = await answerQuestion(note, t.question!, model)
          raw = insertAnswer(note.raw, t.question!, answer)
        } else {
          const body = await chat(AI_NOTES_SYSTEM, aiNotesPrompt(note), model)
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

  const hosted = !/^(localhost|127\.)/.test(location.hostname)
  const doneCount = Object.values(statuses).filter((s) => s === 'done').length

  return (
    <div className="modal-overlay" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span className="sync-title">AI Sync</span>
          {conn === 'ready' && (
            <select
              className="ask-model"
              value={model}
              disabled={phase === 'running'}
              onChange={(e) => { setModelState(e.target.value); setModel(e.target.value) }}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
        <p className="sync-sub">
          Answers open questions and folds your “My Notes” into “AI Notes” across the vault —
          the in-app version of <code>sync-knowledge-notes</code>. Runs on your local Ollama.
        </p>

        {conn === 'checking' && (
          <div className="sync-empty"><span className="spinner ask-spin" /> Connecting to Ollama…</div>
        )}

        {conn === 'down' && (
          <div className="sync-empty">
            <p>Can't reach Ollama at <code>localhost:11434</code>.</p>
            <p className="sync-dim">
              Start it with <code>ollama serve</code>.
              {hosted && (
                <>
                  {' '}Since this site is hosted, also allow it as an origin:{' '}
                  <code>OLLAMA_ORIGINS="{location.origin}" ollama serve</code>
                </>
              )}
            </p>
          </div>
        )}

        {conn === 'ready' && tasks.length === 0 && (
          <div className="sync-empty">
            Nothing to sync — no unanswered <code>Q:</code> entries and no “My Notes” content
            found. Add a question to a note's <code>## Questions</code> section or jot thoughts
            under <code>## My Notes</code>, then run this again.
          </div>
        )}

        {conn === 'ready' && tasks.length > 0 && (
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
          {conn === 'ready' && tasks.length > 0 && phase !== 'finished' && (
            <button className="ask-btn primary" onClick={() => void run()} disabled={phase === 'running' || !model}>
              {phase === 'running' ? 'Syncing…' : `Run ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
