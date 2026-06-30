import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { MarkdownView } from '../reader/MarkdownView'
import { answerQuestion, listModels, getModel, setModel } from './ollama'
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

  const [conn, setConn] = useState<'checking' | 'ready' | 'down'>('checking')
  const [models, setModels] = useState<string[]>([])
  const [model, setModelState] = useState(getModel())
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<'idle' | 'thinking' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)

  const checkConn = () => {
    setConn('checking')
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
  }

  useEffect(checkConn, [])

  useEffect(() => {
    setAnswer('')
    setStatus('idle')
    setSaved(false)
    setError(null)
  }, [notePath])

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight })
  }, [answer])

  if (conn === 'checking') {
    return (
      <div className="ask-panel">
        <div className="panel-header">Ask AI</div>
        <div className="ask-status-msg"><span className="spinner ask-spin" /> Connecting to Ollama…</div>
      </div>
    )
  }

  if (conn === 'down') {
    return (
      <div className="ask-panel">
        <div className="panel-header">Ask AI</div>
        <div className="ask-keysetup">
          <p>Can't reach a local Ollama server at <code>localhost:11434</code>.</p>
          <p className="ask-dim">
            Start it with <code>ollama serve</code> and pull a model (e.g. <code>ollama pull llama3.2</code>).
            Everything runs on your machine — no API key, no data leaves your device.
          </p>
          <button className="ask-btn primary" onClick={checkConn}>Retry connection</button>
        </div>
      </div>
    )
  }

  if (!notePath) {
    return (
      <div className="ask-panel">
        <div className="panel-header">Ask AI</div>
        <div className="empty-state">Open a note to ask about it.</div>
      </div>
    )
  }

  const note = getNote(notePath)

  const ask = async () => {
    const n = getNote(notePath)
    if (!n || !question.trim() || !model || status === 'thinking') return
    setStatus('thinking')
    setAnswer('')
    setSaved(false)
    setError(null)
    try {
      await answerQuestion(n, question, model, (chunk) => setAnswer((a) => a + chunk))
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
        <select
          className="ask-model"
          value={model}
          onChange={(e) => { setModelState(e.target.value); setModel(e.target.value) }}
          title="Ollama model"
        >
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
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
