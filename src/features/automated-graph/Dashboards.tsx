import { useVault } from '../../vault/vaultStore'
import {
  computeNextUp,
  computeToday,
  computeFlashcards,
  type ReviewTopic,
} from './engine'
import './dashboards.css'

function NoteLink({ path, label }: { path: string | null; label: string }) {
  const openNote = useVault((s) => s.openNote)
  if (!path) return <span className="dv-faint">{label}</span>
  return (
    <a className="internal-link" onClick={() => openNote(path)}>
      {label}
    </a>
  )
}

function ReviewTable({ rows, withSpace }: { rows: ReviewTopic[]; withSpace?: boolean }) {
  if (!rows.length) return <p className="dv-faint">Nothing due for review.</p>
  return (
    <table className="dv-table">
      <thead>
        <tr>
          {withSpace && <th>Space</th>}
          <th>Topic</th>
          <th>Confidence</th>
          <th>Last reviewed</th>
          <th>Days since</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            {withSpace && <td>{r.space}</td>}
            <td><NoteLink path={r.path} label={r.title} /></td>
            <td>{r.confidence}/5</td>
            <td>{r.lastReviewed}</td>
            <td>{r.daysSince ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function NextUp({ space }: { space: string }) {
  const index = useVault((s) => s.index)
  if (!index) return null
  const r = computeNextUp(index, space)

  return (
    <div className="dv">
      {r.pick ? (
        <div className="dv-pick">
          <div className="dv-pick-label">Pick</div>
          <div className="dv-pick-title">
            <NoteLink path={r.pick.path} label={r.pick.title} />
          </div>
          <div className="dv-pick-meta">
            Score <strong>{r.pick.score.toFixed(1)}</strong> · importance {r.pick.importance} ·
            unlocks {r.pick.unlocks} · interest {r.pick.interest} · confidence {r.pick.confidence}/5
          </div>
        </div>
      ) : (
        <p className="dv-faint">No frontier topic is ready yet — raise confidence on a prerequisite.</p>
      )}

      <h4 className="dv-h">Frontier (ready now)</h4>
      {r.ranked.length ? (
        <table className="dv-table">
          <thead>
            <tr><th>Topic</th><th>Conf.</th><th>Imp.</th><th>Unlocks</th><th>Int.</th><th>Score</th></tr>
          </thead>
          <tbody>
            {r.ranked.map((c) => (
              <tr key={c.path}>
                <td><NoteLink path={c.path} label={c.title} /></td>
                <td>{c.confidence}/5</td>
                <td>{c.importance}</td>
                <td>{c.unlocks}</td>
                <td>{c.interest}</td>
                <td><strong>{c.score.toFixed(1)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="dv-faint">Nothing ready.</p>
      )}

      {r.locked.length > 0 && (
        <>
          <h4 className="dv-h">Locked (prerequisites not yet confident enough)</h4>
          <table className="dv-table">
            <thead><tr><th>Topic</th><th>Needs</th></tr></thead>
            <tbody>
              {r.locked.map((l) => (
                <tr key={l.path}>
                  <td><NoteLink path={l.path} label={l.title} /></td>
                  <td>
                    {l.needs.map((n, i) => (
                      <span key={n.path}>
                        {i > 0 && ', '}
                        <NoteLink path={n.path} label={n.title} />
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {r.dueForReview.length > 0 && (
        <>
          <h4 className="dv-h">Due for review</h4>
          <ReviewTable rows={r.dueForReview} />
        </>
      )}
    </div>
  )
}

export function Today() {
  const index = useVault((s) => s.index)
  if (!index) return null
  const { picks, reviews } = computeToday(index)
  return (
    <div className="dv">
      <h4 className="dv-h">Next Up, by space</h4>
      {picks.length ? (
        <table className="dv-table">
          <thead><tr><th>Space</th><th>Rank</th><th>Topic</th><th>Score</th><th>Confidence</th></tr></thead>
          <tbody>
            {picks.map((p, i) => (
              <tr key={`${p.space}-${i}`}>
                <td>{p.space}</td>
                <td>{p.rank}</td>
                <td><NoteLink path={p.path} label={p.title} /></td>
                <td>{p.score}</td>
                <td>{p.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="dv-faint">No spaces with a ready frontier topic yet.</p>
      )}
      <h4 className="dv-h">Due for review</h4>
      <ReviewTable rows={reviews} withSpace />
    </div>
  )
}

export function Flashcards() {
  const index = useVault((s) => s.index)
  if (!index) return null
  const top = computeFlashcards(index, 10)
  return (
    <div className="dv">
      <h4 className="dv-h">Flashcard queue (top 10)</h4>
      {top.length ? (
        <table className="dv-table">
          <thead>
            <tr><th>Space</th><th>Topic</th><th>Confidence</th><th>Last reviewed</th><th>Days since</th></tr>
          </thead>
          <tbody>
            {top.map((c) => (
              <tr key={c.path}>
                <td>{c.space}</td>
                <td><NoteLink path={c.path} label={c.title} /></td>
                <td>{c.confidence}/5</td>
                <td>{c.lastReviewed}</td>
                <td>{c.daysSince ?? 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="dv-faint">No topics with confidence &gt; 0 yet.</p>
      )}
    </div>
  )
}
