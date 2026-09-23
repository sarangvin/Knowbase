import { useVault } from '../../vault/vaultStore'
import {
  computeNextUp,
  computeToday,
  computeFlashcards,
  type ReviewTopic,
} from './engine'
import './dashboards.css'

function NoteLink({
  path,
  label,
  pending,
  isNew,
}: {
  path: string | null
  label: string
  pending?: boolean
  isNew?: boolean
}) {
  const openNote = useVault((s) => s.openNote)
  // "New" and "Coming soon" are mutually exclusive by construction: a note
  // is only revealed once its body is written, so a row can never be both.
  // Ordered with New first anyway, because if that invariant ever breaks,
  // "New" is the more useful of the two to see.
  const badge = isNew ? (
    // The anticipation beat the hidden buffer pays for. Finishing a note
    // visibly produces the next one — without this the list is just silently
    // one longer, and the work of pre-generating it goes unnoticed.
    <span className="dv-new" title="Just unlocked by finishing your last note.">
      New
    </span>
  ) : null
  const marker = pending ? (
    // The note exists and is readable — it is a one-line stub while the draft
    // queue gets to it. Saying so beats letting someone open it and conclude
    // the app produced a sentence. It disappears by itself: the flag comes out
    // of the frontmatter in the same write that puts the body in.
    <span className="dv-soon" title="Being written now — the full note will appear here shortly.">
      Coming soon
    </span>
  ) : null
  if (!path) return <span className="dv-faint">{label}{badge}{marker}</span>
  return (
    <>
      <a className="internal-link" onClick={() => openNote(path)}>
        {label}
      </a>
      {badge}
      {marker}
    </>
  )
}

function ReviewTable({ rows, withSpace }: { rows: ReviewTopic[]; withSpace?: boolean }) {
  if (!rows.length) return <p className="dv-faint">Nothing reviewed yet.</p>
  return (
    <table className="dv-table">
      <thead>
        <tr>
          {withSpace && <th>Space</th>}
          <th>Topic</th>
          <th>Int.</th>
          <th>Conf.</th>
          <th>Last reviewed</th>
          <th>Days since</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            {withSpace && <td>{r.space}</td>}
            <td><NoteLink path={r.path} label={r.title} pending={r.pending} /></td>
            <td>{r.interest}</td>
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
          <div className="dv-pick-label">{r.pick.isReview ? 'Review next' : 'Pick'}</div>
          <div className="dv-pick-title">
            <NoteLink path={r.pick.path} label={r.pick.title} pending={r.pick.pending} isNew={r.pick.isNew} />
          </div>
          <div className="dv-pick-meta">
            {r.pick.isReview ? (
              <>
                Nothing new left today · interest {r.pick.interest} · confidence{' '}
                {r.pick.confidence}/5
              </>
            ) : (
              <>
                Score <strong>{r.pick.score.toFixed(1)}</strong> · importance {r.pick.importance} ·
                unlocks {r.pick.unlocks} · interest {r.pick.interest} · confidence{' '}
                {r.pick.confidence}/5
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="dv-faint">
          Nothing to study right now — every topic here has been reviewed today, or is waiting on a
          prerequisite.
        </p>
      )}

      <h4 className="dv-h">New topics (ready now)</h4>
      {r.ranked.length ? (
        <table className="dv-table">
          <thead>
            <tr><th>Topic</th><th>Conf.</th><th>Imp.</th><th>Unlocks</th><th>Int.</th><th>Score</th></tr>
          </thead>
          <tbody>
            {r.ranked.map((c) => (
              <tr key={c.path}>
                <td><NoteLink path={c.path} label={c.title} pending={c.pending} isNew={c.isNew} /></td>
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
        <p className="dv-faint">No new topics — everything ready has been opened at least once.</p>
      )}

      {r.locked.length > 0 && (
        <>
          <h4 className="dv-h">Locked (prerequisites not yet reviewed)</h4>
          <table className="dv-table">
            <thead><tr><th>Topic</th><th>Needs</th></tr></thead>
            <tbody>
              {r.locked.map((l) => (
                <tr key={l.path}>
                  <td><NoteLink path={l.path} label={l.title} pending={l.pending} /></td>
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

      {r.review.length > 0 && (
        <>
          <h4 className="dv-h">Review</h4>
          <ReviewTable rows={r.review} />
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
                {/* No marker needed: a flashcard candidate has confidence > 0,
                    which means it was reviewed, which means it was drafted. */}
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
