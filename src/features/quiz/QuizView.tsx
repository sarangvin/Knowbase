// Placeholder for the Quiz tab. The real implementation — drawing questions
// from each note's "## Questions" section and tracking what you got right —
// lands next; this exists so the tab is never a dead click and so the nav
// bar's shape is settled before the view is built behind it.
import { useVault } from '../../vault/vaultStore'
import { Carrot } from '../../ui/icons'

export function QuizView() {
  const index = useVault((s) => s.index)
  const notes = index ? [...index.notes.values()] : []
  // Counting them now is honest about what the quiz will have to work with,
  // and immediately shows whether a vault has anything to be quizzed on.
  const withQuestions = notes.filter((n) => /^##\s+Questions\s*$/im.test(n.body) && /^\s*[-*]\s+\S/m.test(n.body))

  return (
    <div className="note-scroll">
      <div className="note-container">
        <div className="quiz-soon">
          <div className="quiz-soon-icon"><Carrot width={30} height={30} /></div>
          <span className="quiz-soon-badge">Coming soon</span>
          <h1 className="quiz-soon-title">Quiz yourself</h1>
          <p className="quiz-soon-lede">
            Work through the questions on your notes, rate how well you knew each one, and let
            that feed back into the confidence scores that decide what you study next.
          </p>
          <p className="quiz-soon-stat">
            {withQuestions.length > 0
              ? `${withQuestions.length} note${withQuestions.length === 1 ? '' : 's'} in this vault already ${withQuestions.length === 1 ? 'has' : 'have'} questions ready.`
              : 'No notes with questions yet — generated notes come with a few, and you can add your own under "## Questions".'}
          </p>
        </div>
      </div>
    </div>
  )
}
