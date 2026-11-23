// The homepage for someone who has not signed up.
//
// The old landing was a single card asking "What do you want to learn?" —
// fine for someone who already knew what Rabbithole was, and nothing for
// anyone arriving from a reel who did not. This walks a visitor through why,
// the way Duolingo's homepage does: the promise and a way in at the top, then
// how it works, then one reason at a time with a picture of the real thing,
// then the objections answered, then the way in again.
//
// Conversion choices, each deliberate:
//   - The way in is always one tap away: in the hero, in a sticky header,
//     in a bar pinned to the bottom of a phone once the hero scrolls away,
//     and at the end.
//   - "Read a note first" goes to a real library note with no account — the
//     cheapest possible first step for someone not yet convinced.
//   - The topic strip is the real library, and every chip opens that
//     collection's free preview: proof that the thing works, on subjects the
//     visitor can recognise.
//   - Numbers are real (the library's own counts, fetched live). No invented
//     user counts or testimonials.
//
// The sign-up mechanics (topic carried across Google sign-in, funnel pixels)
// stay in Onboarding.tsx and come in as props.
import { useEffect, useMemo, useRef, useState } from 'react'
import { pickShowcase, SHOWCASES, type Showcase } from './showcase'
import { fetchLibrarySpaces, type LibrarySpace } from './onboardingApi'
import { pixel } from '../../pixel'
import { ArrowRight, Check, Eye, FileText, Flame, Highlighter, RabbitSolid, RotateCw, Search, Snowflake, Sparkles, X } from '../../ui/icons'
import './landing.css'

interface Props {
  topic: string
  setTopic: (t: string) => void
  examples: string
  busy: boolean
  error: string | null
  onStart: (topic?: string) => void
  onLogIn: () => void
}

/** A library collection's free preview: readable without an account. */
function previewHref(space: string): string {
  return `/?read=${encodeURIComponent(space)}&ref=home`
}

/** Fade sections in as they arrive. Off for anyone who asked for less motion. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const items = [...el.querySelectorAll('.hp-reveal')]
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      items.forEach((i) => i.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        }
      },
      { root: el, threshold: 0.15 },
    )
    items.forEach((i) => io.observe(i))
    return () => io.disconnect()
  }, [root])
}

function StartForm({ p, where }: { p: Props; where: 'hero' | 'end' }) {
  // The button is never greyed out: a call to action that looks switched off
  // loses the people who would have tapped it. Tapped with nothing typed, it
  // puts the cursor in the box and says what to do.
  const [nudge, setNudge] = useState(false)
  return (
    <form
      className={'hp-start' + (nudge ? ' is-nudged' : '')}
      onSubmit={(e) => {
        e.preventDefault()
        if (!p.topic.trim()) {
          setNudge(true)
          document.getElementById(`hp-topic-${where}`)?.focus()
          return
        }
        if (where === 'end') pixel('landing_cta_end')
        p.onStart()
      }}
    >
      <label className="hp-visually-hidden" htmlFor={`hp-topic-${where}`}>
        What do you want to learn?
      </label>
      <input
        id={`hp-topic-${where}`}
        className="hp-input"
        placeholder={p.examples}
        value={p.topic}
        onChange={(e) => {
          p.setTopic(e.target.value)
          setNudge(false)
        }}
        disabled={p.busy}
        autoComplete="off"
        enterKeyHint="go"
      />
      <button className="hp-btn hp-btn-primary" type="submit" disabled={p.busy}>
        {p.busy ? <span className="spinner" /> : null} Start learning, free <ArrowRight />
      </button>
      {nudge && <p className="hp-nudge">Type anything you are curious about, like the examples in the box.</p>}
    </form>
  )
}

// ── the pictures: the real app's pieces, drawn small ───────────────────────

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The hero picture: what the app does, in its own three steps. It types a
 *  topic, shows the notes Rabbithole writes for it, then a quiz question, and
 *  moves on to another topic, so "anything you are curious about" is shown
 *  rather than claimed. */
function HeroDemo({ start }: { start: Showcase }) {
  const [idx, setIdx] = useState(() => Math.max(0, SHOWCASES.indexOf(start)))
  const s = SHOWCASES[idx]
  const still = reducedMotion()
  const [typed, setTyped] = useState(still ? s.collection.length : 0)
  const [phase, setPhase] = useState(still ? 2 : 0) // 0 typing, 1 notes, 2 quiz

  useEffect(() => {
    if (still) return
    setTyped(0)
    setPhase(0)
    const timers: number[] = []
    const name = s.collection
    for (let k = 1; k <= name.length; k++) timers.push(window.setTimeout(() => setTyped(k), 350 + k * 70))
    const typedAt = 350 + name.length * 70
    timers.push(window.setTimeout(() => setPhase(1), typedAt + 350))
    timers.push(window.setTimeout(() => setPhase(2), typedAt + 1500))
    timers.push(window.setTimeout(() => setIdx((n) => (n + 1) % SHOWCASES.length), typedAt + 6500))
    return () => timers.forEach(clearTimeout)
  }, [idx, still, s.collection])

  const right = s.quiz.options[s.quiz.right]
  return (
    <div className="hp-phone hp-demo" aria-label={`Example: ${s.collection} turned into short notes and a quiz`}>
      <div className="hp-demo-step"><span className="hp-demo-n">1</span> You name a topic</div>
      <div className="hp-demo-input">
        <Search width={15} height={15} />
        <span>{s.collection.slice(0, typed)}</span>
        {phase === 0 && <span className="hp-caret" />}
      </div>

      <div className={`hp-demo-step ${phase >= 1 ? 'is-on' : ''}`}><span className="hp-demo-n">2</span> Rabbithole writes short notes</div>
      <div className={`hp-demo-notes ${phase >= 1 ? 'is-on' : ''}`}>
        {s.path.slice(0, 3).map((t, i) => (
          <div key={t} className={`hp-demo-row ${i === 0 ? 'is-done' : i === 1 ? 'is-next' : ''}`} style={{ transitionDelay: `${i * 120}ms` }}>
            <span className="hp-demo-ico">{i === 0 ? <Check width={13} height={13} /> : <FileText width={13} height={13} />}</span>
            <span className="hp-demo-title">{t}</span>
            <span className="hp-demo-min">{i === 1 ? 'Read next' : '4 min'}</span>
          </div>
        ))}
        <div className="hp-demo-more" style={{ transitionDelay: '360ms' }}>+ {s.path.length - 3} more, in order</div>
      </div>

      <div className={`hp-demo-step ${phase >= 2 ? 'is-on' : ''}`}><span className="hp-demo-n">3</span> A quick quiz makes it stick</div>
      <div className={`hp-demo-quiz ${phase >= 2 ? 'is-on' : ''}`}>
        <div className="hp-demo-q">{s.quiz.q}</div>
        <div className="hp-demo-a"><Check width={13} height={13} /> {right}</div>
      </div>
    </div>
  )
}

/** "Example" above each picture, so it reads as a sample of the app rather
 *  than as more text to read. */
function Example({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="hp-example">
      <span className="hp-example-tag"><Eye width={13} height={13} /> {label}</span>
      {children}
    </div>
  )
}

function NoteMock({ s }: { s: Showcase }) {
  return (
    <div className="hp-card hp-note" aria-hidden="true">
      <div className="hp-note-eyebrow">{s.collection} · 4 min read</div>
      <div className="hp-note-title">{s.note.title}</div>
      <p>{s.note.body}</p>
      <div className="hp-note-points">
        {s.note.points.map((pt) => (
          <div key={pt}><Check width={14} height={14} /> {pt}</div>
        ))}
      </div>
    </div>
  )
}

function RecallMock({ s }: { s: Showcase }) {
  const [flipped, setFlipped] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  useEffect(() => {
    setFlipped(false)
    setPicked(null)
  }, [s])
  const answered = picked !== null
  return (
    <div className="hp-recall">
      <button
        type="button"
        className={`hp-flip ${flipped ? 'is-flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? `Answer: ${s.card.back}. Tap to flip back.` : `Flashcard: ${s.card.front}. Tap to flip.`}
      >
        <span className="hp-flip-inner">
          <span className="hp-card hp-flip-face">
            <span className="hp-flip-tag">Flashcard</span>
            <strong>{s.card.front}</strong>
            <span className="hp-flip-hint">Tap to flip</span>
          </span>
          <span className="hp-card hp-flip-face hp-flip-back">
            <span className="hp-flip-tag">Answer</span>
            {s.card.back}
            <span className="hp-flip-hint">Tap to flip back</span>
          </span>
        </span>
      </button>
      <div className="hp-card hp-quiz">
        <div className="hp-quiz-q">{s.quiz.q}</div>
        {s.quiz.options.map((o, i) => {
          const state = !answered ? '' : i === s.quiz.right ? 'is-right' : i === picked ? 'is-wrong' : 'is-dim'
          return (
            <button key={o} type="button" className={`hp-quiz-opt ${state}`} disabled={answered} onClick={() => setPicked(i)}>
              {o}
              {answered && i === s.quiz.right && <Check width={14} height={14} />}
              {answered && i === picked && i !== s.quiz.right && <X width={14} height={14} />}
            </button>
          )
        })}
        <div className="hp-quiz-foot" aria-live="polite">
          {!answered ? (
            <span className="hp-muted">Pick an answer</span>
          ) : (
            <>
              <span className={picked === s.quiz.right ? 'hp-good' : 'hp-bad'}>
                {picked === s.quiz.right ? 'Correct!' : `Not quite: it’s “${s.quiz.options[s.quiz.right]}”.`}
              </span>
              <button type="button" className="hp-textbtn" onClick={() => setPicked(null)}>
                <RotateCw width={13} height={13} /> Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StreakMock() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const state = ['done', 'done', 'done', 'frozen', 'done', 'done', 'today']
  return (
    <div className="hp-card hp-streak" aria-hidden="true">
      <div className="hp-streak-flame">
        <Flame width={44} height={44} />
      </div>
      <div className="hp-streak-num">17</div>
      <div className="hp-streak-label">day streak</div>
      <div className="hp-week">
        {days.map((d, i) => (
          <div key={i} className="hp-day">
            <span>{d}</span>
            <span className={`hp-dot is-${state[i]}`}>
              {state[i] === 'done' || state[i] === 'today' ? <Check width={12} height={12} /> : <Snowflake width={12} height={12} />}
            </span>
          </div>
        ))}
      </div>
      <div className="hp-streak-note">
        <Snowflake width={13} height={13} /> A freeze covered Thursday
      </div>
    </div>
  )
}

function DigMock({ s }: { s: Showcase }) {
  // idle: the word waits to be tapped; writing: the note is being made; done.
  const [step, setStep] = useState<'idle' | 'writing' | 'done'>('idle')
  useEffect(() => setStep('idle'), [s])
  useEffect(() => {
    if (step !== 'writing') return
    const t = window.setTimeout(() => setStep('done'), 1300)
    return () => clearTimeout(t)
  }, [step])
  const lit = step !== 'idle'
  return (
    <div className="hp-dig">
      <div className="hp-card hp-note hp-note-sm">
        <p>
          {s.dig.before}
          <button
            type="button"
            className={`hp-dig-word ${lit ? 'is-lit' : ''}`}
            disabled={lit}
            onClick={() => setStep('writing')}
          >
            {s.dig.mark}
          </button>
          {s.dig.after}
        </p>
        <span className={`hp-dig-tool ${lit ? 'is-on' : ''}`} aria-hidden="true">
          <Highlighter width={15} height={15} />
        </span>
      </div>
      {step === 'idle' ? (
        <div className="hp-dig-hint">Tap “{s.dig.mark}” to highlight it</div>
      ) : (
        <div className="hp-dig-arrow" aria-hidden="true"><ArrowRight /></div>
      )}
      <div className={`hp-card hp-dig-new ${step === 'idle' ? 'is-empty' : ''}`} aria-live="polite">
        {step === 'idle' && <span className="hp-dig-sub">Your new note appears here</span>}
        {step === 'writing' && (
          <>
            <span className="hp-flip-tag"><Sparkles width={12} height={12} /> Writing a note…</span>
            <span className="hp-shimmer" />
            <span className="hp-shimmer short" />
          </>
        )}
        {step === 'done' && (
          <>
            <span className="hp-flip-tag"><Sparkles width={12} height={12} /> New note</span>
            <strong>{s.dig.newNote}</strong>
            <span className="hp-dig-sub">
              Linked to the note you were reading ·{' '}
              <button type="button" className="hp-textbtn" onClick={() => setStep('idle')}>Try again</button>
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// ── the page ───────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: '1',
    title: 'Name a topic',
    body: 'Anything at all: Norse mythology, bread baking, game theory, how planes fly. Or start one of the ready-made collections.',
  },
  {
    n: '2',
    title: 'Get a path, not a pile',
    body: 'Rabbithole maps it into short notes in the order you would want to learn them, and writes more as you go.',
  },
  {
    n: '3',
    title: 'Five minutes a day',
    body: 'Read the next note, flip a few flashcards, answer a quick quiz. Small enough to keep doing.',
  },
]

const COMPARE = [
  { what: 'Video rabbit holes', good: 'Fun to watch', bad: 'Gone from your head by Friday' },
  { what: 'Asking a chatbot', good: 'Answers what you ask', bad: 'No path, nothing to review' },
  { what: 'Textbooks and courses', good: 'Thorough', bad: 'Hours a week, easy to quit' },
]

const FAQ = [
  {
    q: 'Is it really free?',
    a: 'Yes. Starting collections, reading notes, flashcards, quizzes and streaks are all free, with generous daily limits. A Pro plan with extras is on its way.',
  },
  {
    q: 'How are the notes made?',
    a: 'Rabbithole builds a learning plan for your topic, then writes each note to the same shape: a clear explanation, the key points, and questions to check yourself. Pro adds sources: real pages, quoted, that back up what you read.',
  },
  {
    q: 'How much time does it take?',
    a: 'About five minutes a day. One note is a 3 to 5 minute read, and the daily flashcards and quiz take a minute or two each.',
  },
  {
    q: 'Do I need to install an app?',
    a: 'No. It runs in the browser on any phone or laptop. On a phone you can add it to your home screen and it opens like an app, with a daily reminder if you want one.',
  },
  {
    q: 'Can I learn more than one thing?',
    a: 'Yes. Keep several collections going at once, and your streak counts any of them.',
  },
]

export function Landing(p: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const heroCtaRef = useRef<HTMLDivElement>(null)
  const [library, setLibrary] = useState<LibrarySpace[]>([])
  const [showBar, setShowBar] = useState(false)
  // One example topic per visit, shared by every picture (showcase.ts).
  const [show] = useState(pickShowcase)
  useReveal(rootRef)

  useEffect(() => {
    let cancelled = false
    void fetchLibrarySpaces().then((l) => !cancelled && setLibrary(l))
    return () => {
      cancelled = true
    }
  }, [])

  // The bottom bar on phones: only once the hero's own button has scrolled away.
  useEffect(() => {
    const el = heroCtaRef.current
    const root = rootRef.current
    if (!el || !root || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setShowBar(!e.isIntersecting), { root, threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // The strip: the fullest collections first, so a chip opens something substantial.
  const chips = useMemo(
    () => [...library].filter((s) => s.topicCount >= 5).sort((a, b) => b.topicCount - a.topicCount).slice(0, 28),
    [library],
  )
  const topics = library.reduce((n, s) => n + s.topicCount, 0)
  const sample = chips[0]?.name

  const scrollToTop = () => {
    rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.setTimeout(() => document.getElementById('hp-topic-hero')?.focus(), 450)
  }

  return (
    <div className="landing" ref={rootRef}>
      <header className="hp-header">
        <div className="hp-wrap hp-header-row">
          <a className="hp-brand" href="/" aria-label="Rabbithole home">
            <span className="hp-logo">
              <RabbitSolid width={20} height={20} />
            </span>
            Rabbithole
          </a>
          <nav className="hp-header-actions">
            <button className="hp-btn hp-btn-ghost" onClick={p.onLogIn}>
              Log in
            </button>
            <button
              className="hp-btn hp-btn-primary hp-btn-sm"
              onClick={() => {
                pixel('landing_cta_header')
                scrollToTop()
              }}
            >
              Get started
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* ── hero ── */}
        <section className="hp-hero">
          <div className="hp-wrap hp-hero-grid">
            <div className="hp-hero-copy">
              <h1 className="hp-h1">
                Fall down the <span className="hp-accent">right</span> rabbit holes.
              </h1>
              <p className="hp-lede">
                Name anything you are curious about. Rabbithole turns it into a short path of five-minute notes,
                then makes it stick with daily flashcards, quizzes and a streak.
              </p>
              {p.error && <div className="hp-error">{p.error}</div>}
              <div ref={heroCtaRef}>
                <StartForm p={p} where="hero" />
              </div>
              <div className="hp-hero-links">
                {sample && (
                  <a className="hp-link" href={previewHref(sample)} onClick={() => pixel('landing_preview_click')}>
                    Not sure yet? Read a free note first <ArrowRight />
                  </a>
                )}
                <span className="hp-muted">No card needed. Sign up with Google in one tap.</span>
              </div>
            </div>
            <div className="hp-hero-art">
              <HeroDemo start={show} />
            </div>
          </div>
        </section>

        {/* ── the library, live ── */}
        {chips.length > 0 && (
          <section className="hp-strip" aria-label="Ready-made collections">
            <p className="hp-strip-title">
              {library.length} collections ready to start · {topics.toLocaleString()} topics written
            </p>
            <div className="hp-marquee">
              <div className="hp-marquee-track">
                {[...chips, ...chips].map((s, i) => (
                  <a
                    key={`${s.key}-${i}`}
                    className="hp-topic-chip"
                    href={previewHref(s.name)}
                    tabIndex={i >= chips.length ? -1 : 0}
                    aria-hidden={i >= chips.length}
                    onClick={() => pixel('landing_chip_click')}
                  >
                    {s.name}
                    <span>{s.topicCount}</span>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── how it works ── */}
        <section className="hp-section">
          <div className="hp-wrap">
            <h2 className="hp-h2 hp-center hp-reveal">How it works</h2>
            <div className="hp-steps">
              {STEPS.map((s) => (
                <div key={s.n} className="hp-step hp-reveal">
                  <span className="hp-step-n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── reasons, one at a time ── */}
        <section className="hp-section hp-feature">
          <div className="hp-wrap hp-feature-grid">
            <div className="hp-feature-copy hp-reveal">
              <span className="hp-kicker">Short on purpose</span>
              <h2 className="hp-h2">Five-minute notes you will actually finish.</h2>
              <p>
                Every note is one idea, explained plainly, with the key points pulled out. No 40-minute videos,
                no 300-page books. Read one with your morning coffee and you have learnt something today.
              </p>
            </div>
            <div className="hp-feature-art hp-reveal">
              <Example label="Example note">
                <NoteMock s={show} />
              </Example>
            </div>
          </div>
        </section>

        <section className="hp-section hp-feature hp-feature-flip">
          <div className="hp-wrap hp-feature-grid">
            <div className="hp-feature-copy hp-reveal">
              <span className="hp-kicker">Made to stick</span>
              <h2 className="hp-h2">Reading is not remembering. This is.</h2>
              <p>
                Every note comes with its own flashcards and quiz questions. Each day you get a short deck and a
                quick quiz from what you have read, so it is still there next month.
              </p>
            </div>
            <div className="hp-feature-art hp-reveal">
              <Example label="Try it: flashcard and quiz">
                <RecallMock s={show} />
              </Example>
            </div>
          </div>
        </section>

        <section className="hp-section hp-feature">
          <div className="hp-wrap hp-feature-grid">
            <div className="hp-feature-copy hp-reveal">
              <span className="hp-kicker">A habit, not homework</span>
              <h2 className="hp-h2">A streak that forgives a busy day.</h2>
              <p>
                Read a note, finish your flashcards or take the quiz, and the day counts. Miss one and a streak
                freeze covers it, so one bad Tuesday does not undo three weeks.
              </p>
            </div>
            <div className="hp-feature-art hp-reveal">
              <Example label="Example streak">
                <StreakMock />
              </Example>
            </div>
          </div>
        </section>

        <section className="hp-section hp-feature hp-feature-flip">
          <div className="hp-wrap hp-feature-grid">
            <div className="hp-feature-copy hp-reveal">
              <span className="hp-kicker">Follow your curiosity</span>
              <h2 className="hp-h2">Highlight a word. Get a whole new note on it.</h2>
              <p>
                Hit something you want to know more about? Highlight it, and Rabbithole writes a new note on it,
                linked to the one you were reading. That is the rabbit hole, on purpose.
              </p>
            </div>
            <div className="hp-feature-art hp-reveal">
              <Example label="Try it: highlight a word">
                <DigMock s={show} />
              </Example>
            </div>
          </div>
        </section>

        {/* ── why not just... ── */}
        <section className="hp-section">
          <div className="hp-wrap">
            <h2 className="hp-h2 hp-center hp-reveal">Why not just…</h2>
            <div className="hp-compare">
              {COMPARE.map((c) => (
                <div key={c.what} className="hp-compare-row hp-reveal">
                  <div className="hp-compare-what">{c.what}</div>
                  <div className="hp-compare-good">
                    <Check width={14} height={14} /> {c.good}
                  </div>
                  <div className="hp-compare-bad">{c.bad}</div>
                </div>
              ))}
              <div className="hp-compare-row hp-compare-us hp-reveal">
                <div className="hp-compare-what">
                  <RabbitSolid width={16} height={16} /> Rabbithole
                </div>
                <div className="hp-compare-good">
                  <Check width={14} height={14} /> A path through the topic
                </div>
                <div className="hp-compare-good">
                  <Check width={14} height={14} /> Five minutes a day, and you keep it
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── questions ── */}
        <section className="hp-section">
          <div className="hp-wrap hp-faq-wrap">
            <h2 className="hp-h2 hp-center hp-reveal">Questions</h2>
            <div className="hp-faq">
              {FAQ.map((f) => (
                <details key={f.q} className="hp-faq-item hp-reveal">
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── the way in, again ── */}
        <section className="hp-section hp-final">
          <div className="hp-wrap hp-final-inner hp-reveal">
            <div className="hp-logo hp-logo-lg">
              <RabbitSolid width={34} height={34} />
            </div>
            <h2 className="hp-h2">Your next rabbit hole is one topic away.</h2>
            <StartForm p={p} where="end" />
            {sample && (
              <a className="hp-link" href={previewHref(sample)} onClick={() => pixel('landing_preview_click')}>
                Or read a free note first <ArrowRight />
              </a>
            )}
          </div>
        </section>
      </main>

      <footer className="hp-footer">
        <div className="hp-wrap hp-footer-row">
          <span className="hp-brand hp-brand-sm">
            <span className="hp-logo">
              <RabbitSolid width={16} height={16} />
            </span>
            Rabbithole
          </span>
          <nav>
            <button className="hp-link-plain" onClick={p.onLogIn}>
              Log in
            </button>
            <a className="hp-link-plain" href="https://www.instagram.com/rabbitholelearn/" target="_blank" rel="noopener">
              Instagram
            </a>
            <a className="hp-link-plain" href="/privacy" target="_blank" rel="noopener">
              Privacy
            </a>
            <a className="hp-link-plain" href="/terms" target="_blank" rel="noopener">
              Terms
            </a>
          </nav>
        </div>
      </footer>

      {/* Phones: the way in stays in reach once the hero's button has gone. */}
      <div className={`hp-bottom-bar${showBar ? ' is-on' : ''}`}>
        <button
          className="hp-btn hp-btn-primary hp-btn-block"
          onClick={() => {
            pixel('landing_cta_bar')
            scrollToTop()
          }}
        >
          Start learning, free <ArrowRight />
        </button>
      </div>
    </div>
  )
}
