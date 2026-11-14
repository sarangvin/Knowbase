import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useVault } from '../../vault/vaultStore'
import { Check, HelpCircle, Lock, Star } from '../../ui/icons'
import {
  computeNextUp,
  computeToday,
  computeFlashcards,
  briefOf,
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

/**
 * How this page works, in the few lines a reader needs — behind a button
 * rather than written out under every collection. The long version (scores,
 * weights, thresholds) was for tuning, not for reading.
 */
function NextUpInfo() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('touchstart', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('touchstart', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span className="dv-info" ref={ref}>
      <button
        className="dv-info-btn"
        aria-label="How this works"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <HelpCircle width={15} height={15} />
      </button>
      {open && (
        <div className="dv-info-pop" role="dialog" aria-label="How this works">
          <ul>
            <li><strong>Start</strong>: the best topic to read next.</li>
            <li><strong>Stars</strong>: ready to read, because you have read what they build on. The ones that open up the most come first.</li>
            <li><strong>Locks</strong>: waiting on a topic you have not read yet.</li>
            <li><strong>Checks</strong>: topics you have finished. Tap one to review it.</li>
          </ul>
          <p>Interested finishes a note; Not interested skips it. Either way, your answer decides what gets written next.</p>
        </div>
      )}
    </span>
  )
}

type PathStep = {
  key: string
  state: 'done' | 'current' | 'open' | 'locked'
  path: string
  title: string
  pending?: boolean
  isNew?: boolean
  meta: string
}

/** How many finished topics show above the current one before the rest
 *  fold away. A long run of check marks pushes the thing to do off screen. */
const DONE_VISIBLE = 3

/** Sideways offset of the n-th step, in px: a gentle zig-zag so the path
 *  reads as a route rather than a list. */
function swayOf(i: number): number {
  return Math.round(Math.sin(i * 0.9) * 44)
}

function StepIcon({ state }: { state: PathStep['state'] }) {
  if (state === 'done') return <Check width={26} height={26} strokeWidth={3} />
  if (state === 'locked') return <Lock width={22} height={22} />
  return <Star width={state === 'current' ? 30 : 24} height={state === 'current' ? 30 : 24} fill="currentColor" strokeWidth={1.5} />
}

function PathNode({ step, index }: { step: PathStep; index: number }) {
  const openNote = useVault((s) => s.openNote)
  // What the next topics are about, so the path reads as a story rather than
  // a list of titles. Finished and locked steps keep just their status line.
  const brief = useVault((s) =>
    s.index && (step.state === 'current' || step.state === 'open') ? briefOf(s.index, step.path) : null,
  )
  return (
    <li className={`lp-step is-${step.state}`} style={{ '--sway': `${swayOf(index)}px` } as CSSProperties}>
      <div className="lp-node-wrap">
        {step.state === 'current' && <span className="lp-bubble">Start</span>}
        <button
          className="lp-node"
          onClick={() => openNote(step.path)}
          aria-label={`${step.title} (${step.state === 'current' ? 'start here' : step.state})`}
        >
          <StepIcon state={step.state} />
        </button>
      </div>
      <div className="lp-label">
        <a className="lp-title" onClick={() => openNote(step.path)}>{step.title}</a>
        {step.isNew && (
          <span className="dv-new" title="Just unlocked by finishing your last note.">New</span>
        )}
        {step.pending && (
          <span className="dv-soon" title="Being written now — the full note will appear here shortly.">
            Coming soon
          </span>
        )}
        {brief && <div className="lp-brief">{brief}</div>}
        <div className="lp-meta">{step.meta}</div>
      </div>
    </li>
  )
}

export function NextUp({ space }: { space: string }) {
  const index = useVault((s) => s.index)
  const [showAllDone, setShowAllDone] = useState(false)
  const pathRef = useRef<HTMLOListElement>(null)
  const hasIndex = !!index

  // Open with the step to tap in the middle of the screen, the way a path
  // should: what is behind you above it, what is ahead below. Once per
  // collection, not on every re-render — a reader who has scrolled away to
  // look at something should not be pulled back. A frame late, because the
  // reader resets its scroll to the top when a note opens, and that runs
  // after this component's own effects.
  useEffect(() => {
    if (!hasIndex) return
    const raf = requestAnimationFrame(() => {
      pathRef.current
        ?.querySelector('.lp-step.is-current')
        ?.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(raf)
  }, [space, hasIndex])

  if (!index) return null
  const r = computeNextUp(index, space)

  // The path runs the way you walked it: what you have finished on top
  // (oldest first), the pick, what is open after it, and what is still
  // locked at the bottom. The engine's review order (most worth revisiting
  // first) is for choosing a review, not for drawing a route.
  const done: PathStep[] = r.review
    .filter((t) => !(r.pick?.isReview && t.path === r.pick.path))
    .slice()
    .sort((a, b) => a.lastReviewed.localeCompare(b.lastReviewed))
    .map((t) => ({
      key: t.path,
      state: 'done',
      path: t.path,
      title: t.title,
      pending: t.pending,
      meta: `Confidence ${t.confidence}/5 · ${t.daysSince === 0 ? 'today' : t.daysSince === 1 ? 'yesterday' : t.daysSince == null ? 'read' : `${t.daysSince} days ago`}`,
    }))
  const current: PathStep[] = r.pick
    ? [{
        key: r.pick.path,
        state: 'current',
        path: r.pick.path,
        title: r.pick.title,
        pending: r.pick.pending,
        isNew: r.pick.isNew,
        meta: r.pick.isReview
          ? `Review · confidence ${r.pick.confidence}/5`
          : r.pick.unlocks
            ? `Unlocks ${r.pick.unlocks} more`
            : 'Up next',
      }]
    : []
  const open: PathStep[] = r.ranked
    .filter((t) => t.path !== r.pick?.path)
    .map((t) => ({
      key: t.path,
      state: 'open',
      path: t.path,
      title: t.title,
      pending: t.pending,
      isNew: t.isNew,
      meta: t.unlocks ? `Ready · unlocks ${t.unlocks} more` : 'Ready',
    }))
  const locked: PathStep[] = r.locked.map((t) => ({
    key: t.path,
    state: 'locked',
    path: t.path,
    title: t.title,
    pending: t.pending,
    meta: t.needs.length ? `After ${t.needs.map((n) => n.title).join(', ')}` : 'Locked',
  }))

  const hidden = showAllDone ? 0 : Math.max(0, done.length - DONE_VISIBLE)
  const steps = [...done.slice(hidden), ...current, ...open, ...locked]

  return (
    <div className="dv">
      <h4 className="dv-h dv-h-info">
        Your path
        <NextUpInfo />
      </h4>
      {hidden > 0 && (
        <button className="lp-more" onClick={() => setShowAllDone(true)}>
          Show {hidden} earlier {hidden === 1 ? 'topic' : 'topics'}
        </button>
      )}
      {steps.length ? (
        <ol className="lp" ref={pathRef}>
          {steps.map((s, i) => <PathNode key={s.key} step={s} index={i + hidden} />)}
        </ol>
      ) : (
        <p className="dv-faint">Nothing here yet.</p>
      )}
      {!r.pick && steps.length > 0 && (
        <p className="dv-faint">
          Nothing to study right now — every topic here has been reviewed today, or is waiting on a
          prerequisite.
        </p>
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
