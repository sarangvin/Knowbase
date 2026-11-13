// `/?read=<Collection>`: the first note of a library collection, readable
// before signing up. Reel links point here so somebody who just watched a
// reel about Norse mythology reads about Norse mythology, and only then is
// asked for an account — which starts that same collection for them.
import { useEffect, useState, type CSSProperties } from 'react'
import { useVault } from '../../vault/vaultStore'
import { splitFrontmatter } from '../../vault/parse'
import { extractSection } from '../../vault/sections'
import { MarkdownView } from '../reader/MarkdownView'
import { setPendingTopic } from './pendingTopic'
import { clearReadLink, markPreviewed } from '../../deepLink'
import { pixel } from '../../pixel'
import { ArrowRight, Check, Lock, RabbitSolid, Star } from '../../ui/icons'
import '../automated-graph/dashboards.css'
import '../reader/noteview.css'
import './onboarding.css'

interface Preview {
  space: string
  title: string
  content: string
  topicCount: number
  /** The topics after this one, in study order. */
  next?: { title: string; needs: string[] }[]
}

/** Same sway as the Next Up path (Dashboards.tsx), so it reads as one route. */
function swayOf(i: number): number {
  return Math.round(Math.sin(i * 0.9) * 44)
}

export function LibraryPreview({ space, onLeave }: { space: string; onLeave: () => void }) {
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`/api/vaults/library/preview?space=${encodeURIComponent(space)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Preview>) : Promise.reject(new Error(String(r.status)))))
      .then((p) => {
        setPreview(p)
        pixel('preview_view')
      })
      .catch(() => setFailed(true))
  }, [space])

  // Nothing to show (renamed collection, typo in a link): the normal landing.
  useEffect(() => {
    if (failed) {
      clearReadLink()
      onLeave()
    }
  }, [failed, onLeave])

  const signUp = () => {
    if (!preview) return
    pixel('preview_signup_click')
    setPendingTopic(preview.space)
    markPreviewed(preview.title)
    clearReadLink()
    loginWithGoogle()
  }

  if (!preview) {
    return (
      <div className="onboarding">
        <div className="spinner" />
      </div>
    )
  }

  // The prose only: the reader's own sections (My Notes, Questions) are for
  // after they have a copy.
  const body = splitFrontmatter(preview.content).body
  const notes = extractSection(preview.content, 'AI Notes')?.text ?? body
  const next = preview.next ?? []
  // The start of the learning path, drawn the way Next Up draws it: the note
  // they just read checked off, the next one as the step to tap, and what
  // follows still locked until they have an account.
  const steps = [
    { title: preview.title, state: 'done' as const, meta: 'Just read' },
    ...next.map((t, i) => ({
      title: t.title,
      state: i === 0 ? ('current' as const) : ('locked' as const),
      meta: i === 0 ? 'Up next' : t.needs.length ? `After ${t.needs.join(', ')}` : 'Locked',
    })),
  ]

  return (
    <div className="preview-page">
      <header className="preview-top">
        <RabbitSolid width={22} height={22} />
        <span>Rabbithole · {preview.space}</span>
      </header>
      <div className="note-scroll preview-scroll">
        <div className="note-container">
          <h1 className="note-title">{preview.title}</h1>
          <MarkdownView content={notes} />
          <div className="dv preview-path">
            <ol className="lp">
              {steps.map((st, i) => (
                <li
                  key={st.title}
                  className={`lp-step is-${st.state}`}
                  style={{ '--sway': `${swayOf(i)}px` } as CSSProperties}
                >
                  <div className="lp-node-wrap">
                    {st.state === 'current' && <span className="lp-bubble">Next</span>}
                    <button
                      className="lp-node"
                      onClick={st.state === 'done' ? undefined : signUp}
                      aria-label={`${st.title} (${st.state === 'current' ? 'sign in to read next' : st.state})`}
                    >
                      {st.state === 'done' ? (
                        <Check width={26} height={26} strokeWidth={3} />
                      ) : st.state === 'locked' ? (
                        <Lock width={22} height={22} />
                      ) : (
                        <Star width={30} height={30} fill="currentColor" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                  <div className="lp-label">
                    <span className="lp-title">{st.title}</span>
                    <div className="lp-meta">{st.meta}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="preview-cta">
            <p className="preview-cta-line">
              To continue reading the next topic{next[0] ? <>, <strong>{next[0].title}</strong></> : null}
            </p>
            <button className="ob-btn primary" onClick={signUp}>
              <ArrowRight /> Sign in with Google
            </button>
            <button
              className="ob-linklike"
              onClick={() => {
                clearReadLink()
                onLeave()
              }}
            >
              or pick your own topic
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
