// The `## Questions` section, made usable.
//
// It has been inert since the beginning: the generator writes questions
// nothing can answer, and the only way to get an answer was the Sync tool in
// Settings, which reads a different shape and therefore found nothing. Here
// each question has an Answer button next to it, and the reader can add one
// of their own.
//
// Every write goes through the server — answers cost a model call and custom
// questions are rate-limited, and a limit the client enforces is not a limit.
// After each one the vault is reloaded, so what is on screen is what is in
// the note rather than a local guess about it.
import { useEffect, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { slugify } from '../../vault/parse'
import { spaceOfPath } from '../../vault/collections'
import { Sparkles, Trash, HelpCircle } from '../../ui/icons'
import { answerQuestion, deleteQuestion, fetchAllowance, type Allowance } from './questionsApi'
import type { ReaderQuestion } from './questionsFormat'
import type { Note } from '../../vault/types'

export function Questions({ note, items }: { note: Note; items: ReaderQuestion[] }) {
  const reload = useVault((s) => s.reload)
  const writable = useVault((s) => s.writable)
  const user = useVault((s) => s.user)

  const space = spaceOfPath(note.path)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [allowance, setAllowance] = useState<Allowance | null>(null)

  // Every button here calls the server, so all of them need an account —
  // not just a writable source. The demo vault is writable through a local
  // overlay and has no account at all, and an Answer button that 401s is
  // worse than one that is not there.
  const canAnswer = writable && !!user?.accessApproved
  // Asking your own also needs a collection, because the allowance is
  // counted per collection.
  const canAsk = canAnswer && !!space

  useEffect(() => {
    if (!canAsk || !space) return
    let cancelled = false
    fetchAllowance(space)
      .then((a) => !cancelled && setAllowance(a))
      .catch(() => !cancelled && setAllowance(null))
    return () => {
      cancelled = true
    }
  }, [canAsk, space, note.path])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      // The note changed on the server. Re-read rather than patching: the
      // answer was written into the markdown, and this component renders
      // what the markdown says.
      await reload()
      if (canAsk && space) setAllowance(await fetchAllowance(space).catch(() => allowance ?? null))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const ask = () => {
    const q = draft.trim()
    if (q.length < 5) return
    void run('new', async () => {
      await answerQuestion(note.path, q, true)
      setDraft('')
    })
  }

  const remaining = allowance?.remaining ?? 0

  return (
    <section className="qa">
      <h2 id={slugify('Questions')}>Questions</h2>

      {items.length === 0 && <p className="qa-empty">No questions on this note yet.</p>}
      {items.length > 0 && !canAnswer && writable && (
        <p className="qa-empty">Answers are generated from your own notes — sign in to use them.</p>
      )}

      <ol className="qa-list">
        {items.map((q) => (
          <li key={q.question} className="qa-item">
            <div className="qa-q">{q.question}</div>
            {q.answer ? (
              <div className="qa-a">{q.answer}</div>
            ) : (
              canAnswer && (
                <button
                  className="qa-btn"
                  disabled={busy != null}
                  onClick={() => void run(q.question, () => answerQuestion(note.path, q.question, false))}
                >
                  {busy === q.question ? <span className="spinner" /> : <Sparkles width={13} height={13} />}
                  {busy === q.question ? 'Answering…' : 'Answer'}
                </button>
              )
            )}
            {/* Any question can be removed, not only the reader's own: a
                generated question that is wrong or dull is noise on a note
                they have to keep reading. */}
            {canAnswer && (
              <button
                className="qa-remove"
                aria-label={`Delete question: ${q.question}`}
                disabled={busy != null}
                onClick={() => void run(q.question, () => deleteQuestion(note.path, q.question))}
              >
                <Trash width={13} height={13} />
              </button>
            )}
          </li>
        ))}
      </ol>

      {canAsk && (
        <div className="qa-ask">
          <div className="qa-ask-label">
            <HelpCircle width={13} height={13} /> Ask your own
          </div>
          {remaining > 0 ? (
            <>
              <textarea
                className="qa-ask-input"
                rows={2}
                value={draft}
                placeholder="Something this note left you wondering…"
                disabled={busy != null}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask()
                }}
              />
              <div className="qa-ask-foot">
                <span className="qa-ask-note">
                  Answered from this note. {remaining} left today
                  {space ? ` on ${space}` : ''}.
                </span>
                <button className="qa-btn primary" disabled={draft.trim().length < 5 || busy != null} onClick={ask}>
                  {busy === 'new' ? <span className="spinner" /> : <Sparkles width={13} height={13} />}
                  {busy === 'new' ? 'Answering…' : 'Answer'}
                </button>
              </div>
            </>
          ) : (
            <p className="qa-ask-note">
              {allowance == null
                ? 'Checking…'
                : `That's your question for today${space ? ` on ${space}` : ''}. You can ask another tomorrow.`}
            </p>
          )}
        </div>
      )}

      {error && <div className="qa-error">{error}</div>}
    </section>
  )
}
