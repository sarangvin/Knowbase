// The Quiz tab: five multiple-choice questions a day, built from the notes
// you have actually reviewed.
//
// One question on screen at a time rather than a list of five. A list invites
// skimming ahead and turns the quiz into a form to fill in; one at a time
// keeps it a sequence of small commitments, which is what makes getting one
// wrong feel like information rather than a mark out of five.
//
// Answering is a single tap and cannot be taken back. That is the point of
// the exercise — a retry until right measures persistence, not recall — and
// it is enforced on the server, so reloading does not reset it.
import { useEffect, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { Carrot, Check, X, RotateCw } from '../../ui/icons'
import { fetchToday, startToday, answerQuestion, type Quiz } from './quizApi'
import './quiz.css'

const PASS_MARK = 0.6

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="note-scroll">
      <div className="note-container quiz-wrap">{children}</div>
    </div>
  )
}

export function QuizView() {
  const user = useVault((s) => s.user)
  const openNote = useVault((s) => s.openNote)

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const [reviewedNotes, setReviewedNotes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Which question is on screen, and the result of the tap just made.
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  // Separate from quiz.completed on purpose. Answering the last question
  // completes the quiz server-side immediately, and switching screens on
  // that would whip the result of the final tap away before it was read.
  // The user asks for the summary; they are not dropped into it.
  const [showResults, setShowResults] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchToday()
      .then((t) => {
        if (cancelled) return
        setQuiz(t.quiz)
        setAvailable(t.available)
        setReviewedNotes(t.notes ?? 0)
        // Resume where they stopped rather than at question one — and for a
        // quiz already finished in an earlier session, go straight to it.
        if (t.quiz?.completed) setShowResults(true)
        else if (t.quiz) setAt(Math.max(0, t.quiz.questions.findIndex((q) => q.chosen == null)))
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const start = async () => {
    if (starting) return
    setStarting(true)
    setError(null)
    try {
      const q = await startToday()
      setQuiz(q)
      setAt(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const pick = async (choice: number) => {
    if (!quiz || busy) return
    const q = quiz.questions[at]
    if (!q || q.chosen != null) return
    setBusy(true)
    setError(null)
    try {
      const r = await answerQuestion(at, choice)
      // Patch in place so the answered state, the revealed key and the score
      // all come from the server's reply rather than from a local guess.
      setQuiz({
        ...quiz,
        score: r.score,
        completed: r.completed,
        questions: quiz.questions.map((x, i) => (i === at ? { ...x, chosen: choice, answer: r.answer } : x)),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!user?.accessApproved) {
    return (
      <Shell>
        <div className="quiz-empty">
          <span className="quiz-empty-icon"><Carrot width={28} height={28} /></span>
          <h1>Quiz</h1>
          <p>Quizzes are built from your own notes, so this opens up once your account does.</p>
        </div>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="quiz-empty"><span className="spinner" /></div>
      </Shell>
    )
  }

  // ── Nothing to ask about yet ────────────────────────────────────────────
  if (!quiz) {
    const enough = (available ?? 0) > 0
    return (
      <Shell>
        <div className="quiz-empty">
          <span className="quiz-empty-icon"><Carrot width={28} height={28} /></span>
          <h1>Today's quiz</h1>
          {enough ? (
            <>
              <p>
                Five questions, drawn at random from the {available} on the {reviewedNotes} note
                {reviewedNotes === 1 ? '' : 's'} you have reviewed.
              </p>
              {error && <div className="quiz-error">{error}</div>}
              <button className="quiz-btn primary" disabled={starting} onClick={() => void start()}>
                {starting ? <span className="spinner" /> : null}
                {starting ? 'Writing your questions…' : 'Start'}
              </button>
              <p className="quiz-note">One quiz a day. Tomorrow's will draw from whatever you have read by then.</p>
            </>
          ) : (
            <>
              <p>
                Nothing to ask you yet. Quizzes come from the questions on notes you have
                reviewed — read one to the end and mark it reviewed, and this fills up.
              </p>
              {error && <div className="quiz-error">{error}</div>}
            </>
          )}
        </div>
      </Shell>
    )
  }

  // ── Finished ────────────────────────────────────────────────────────────
  if (showResults) {
    const ratio = quiz.total ? quiz.score / quiz.total : 0
    return (
      <Shell>
        <div className="quiz-done">
          <div className={'quiz-score' + (ratio >= PASS_MARK ? ' is-good' : '')}>
            {quiz.score}
            <span className="quiz-score-of">/{quiz.total}</span>
          </div>
          <p className="quiz-done-line">
            {ratio === 1
              ? 'Every one. Nothing to revisit.'
              : ratio >= PASS_MARK
                ? 'Most of the way there.'
                : 'Worth another pass at these.'}
          </p>
          <ul className="quiz-recap">
            {quiz.questions.map((q, i) => {
              const right = q.chosen === q.answer
              return (
                <li key={i} className={right ? 'is-right' : 'is-wrong'}>
                  <span className="quiz-recap-mark">{right ? <Check width={14} height={14} /> : <X width={14} height={14} />}</span>
                  <div className="quiz-recap-body">
                    <div className="quiz-recap-q">{q.question}</div>
                    {!right && q.answer != null && (
                      <div className="quiz-recap-a">Answer: {q.options[q.answer]}</div>
                    )}
                    {/* The note is the point — a wrong answer should be one
                        tap from the thing that explains it. */}
                    <button className="quiz-recap-note" onClick={() => openNote(q.notePath)}>
                      {q.noteTitle}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="quiz-note">
            <RotateCw width={13} height={13} /> That's today's. A new one tomorrow.
          </p>
        </div>
      </Shell>
    )
  }

  // ── In progress ─────────────────────────────────────────────────────────
  const q = quiz.questions[at]
  const answered = q.chosen != null
  const lastOne = at >= quiz.questions.length - 1

  return (
    <Shell>
      <div className="quiz-run">
        <div className="quiz-progress">
          <span>
            Question {at + 1} of {quiz.questions.length}
          </span>
          <span className="quiz-progress-bar" aria-hidden="true">
            <span style={{ width: `${((at + (answered ? 1 : 0)) / quiz.questions.length) * 100}%` }} />
          </span>
          <span className="quiz-progress-score">{quiz.score} right</span>
        </div>

        <div className="quiz-source">{q.noteTitle}</div>
        <h1 className="quiz-question">{q.question}</h1>

        <div className="quiz-options" role="group" aria-label="Answers">
          {q.options.map((opt, i) => {
            const isAnswer = answered && q.answer === i
            const isWrongPick = answered && q.chosen === i && q.answer !== i
            return (
              <button
                key={i}
                className={'quiz-option' + (isAnswer ? ' is-answer' : '') + (isWrongPick ? ' is-wrong' : '')}
                disabled={answered || busy}
                onClick={() => void pick(i)}
              >
                <span className="quiz-option-key">{String.fromCharCode(65 + i)}</span>
                <span className="quiz-option-text">{opt}</span>
                {isAnswer && <Check width={15} height={15} />}
                {isWrongPick && <X width={15} height={15} />}
              </button>
            )
          })}
        </div>

        {error && <div className="quiz-error">{error}</div>}

        {answered && (
          <div className="quiz-after">
            <span className={q.chosen === q.answer ? 'quiz-verdict is-right' : 'quiz-verdict is-wrong'}>
              {q.chosen === q.answer ? 'Correct' : 'Not quite'}
            </span>
            <button className="quiz-recap-note" onClick={() => openNote(q.notePath)}>
              Open {q.noteTitle}
            </button>
            {!lastOne && (
              <button className="quiz-btn primary" onClick={() => setAt(at + 1)}>
                Next
              </button>
            )}
            {lastOne && (
              <button className="quiz-btn primary" onClick={() => setShowResults(true)}>
                See results
              </button>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}
