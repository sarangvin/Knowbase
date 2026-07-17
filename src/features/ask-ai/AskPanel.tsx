import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { MarkdownView } from '../reader/MarkdownView'
import { answerQuestion, type LlmProvider } from './llmProvider'
import { PROVIDERS, getActiveProviderId, setActiveProviderId, getProvider } from './providerRegistry'
import { getModel, setModel as persistOllamaModel } from './ollama'
import { insertQA, bumpLastReviewed } from './askInsert'
import './ask.css'

export function AskPanel() {
  const notePath = useVault((s) => {
    const v = s.activeView()
    return v?.kind === 'note' ? v.path : null
  })
  const getNote = useVault((s) => s.getNote)
  const saveNote = useVault((s) => s.saveNote)
  const openNote = useVault((s) => s.openNote)

  const [providerId, setProviderId] = useState<LlmProvider['id']>(getActiveProviderId())
  const provider = getProvider(providerId)

  const [readiness, setReadiness] = useState<'checking' | 'ready' | 'not-ready'>('checking')
  const [readyMessage, setReadyMessage] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState(getModel())

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<'idle' | 'thinking' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    setAnswer('')
    setStatus('idle')
    setSaved(false)
    setError(null)
  }, [notePath])

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight })
  }, [answer])

  const providerPicker = (
    <select className="ask-model" value={providerId} onChange={(e) => selectProvider(e.target.value)} title="AI provider">
      {PROVIDERS.map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  )

  if (readiness === 'checking') {
    return (
      <div className="ask-panel">
        <div className="panel-header">Ask AI {providerPicker}</div>
        <div className="ask-status-msg"><span className="spinner ask-spin" /> Connecting…</div>
      </div>
    )
  }

  if (readiness === 'not-ready') {
    return (
      <div className="ask-panel">
        <div className="panel-header">Ask AI {providerPicker}</div>
        <div className="ask-keysetup">
          <p>{readyMessage ?? 'This provider is not available right now.'}</p>
          <button className="ask-btn primary" onClick={checkReadiness}>Retry</button>
        </div>
      </div>
    )
  }

  if (!notePath) {
    return (
      <div className="ask-panel">
        <div className="panel-header">Ask AI {providerPicker}</div>
        <div className="empty-state">Open a note to ask about it.</div>
      </div>
    )
  }

  const note = getNote(notePath)

  const ask = async () => {
    const n = getNote(notePath)
    if (!n || !question.trim() || status === 'thinking') return
    setStatus('thinking')
    setAnswer('')
    setSaved(false)
    setError(null)
    try {
      await answerQuestion(provider, n, question, model, (chunk) => setAnswer((a) => a + chunk))
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const saveToNote = async () => {
    const n = getNote(notePath)
    if (!n || !answer) return
    let raw = insertQA(n.raw, question, answer)
    raw = bumpLastReviewed(raw)
    try {
      await saveNote(notePath, raw)
      setSaved(true)
      openNote(notePath, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="ask-panel">
      <div className="panel-header">
        Ask AI
        {providerPicker}
        {models.length > 0 && (
          <select
            className="ask-model"
            value={model}
            onChange={(e) => { setModel(e.target.value); persistOllamaModel(e.target.value) }}
            title="Model"
          >
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>
      <div className="ask-input-row">
        <textarea
          className="ask-textarea"
          placeholder={`Ask about "${note?.title}"…`}
          value={question}
          rows={2}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void ask()
            }
          }}
        />
        <button className="ask-btn primary" disabled={!question.trim() || status === 'thinking'} onClick={() => void ask()}>
          {status === 'thinking' ? <span className="spinner ask-spin" /> : 'Ask'}
        </button>
      </div>

      {error && <div className="ask-error">{error}</div>}

      {(answer || status === 'thinking') && (
        <div className="ask-answer" ref={answerRef}>
          <MarkdownView content={answer || '…'} notePath={notePath} />
        </div>
      )}

      {status === 'done' && answer && (
        <div className="ask-actions">
          {saved ? (
            <span className="ask-saved">✓ Added to note's Questions</span>
          ) : (
            <button className="ask-btn" onClick={() => void saveToNote()}>Save to note</button>
          )}
        </div>
      )}
    </div>
  )
}
