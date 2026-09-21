// The Flashcards tab: a stack of ten cards a day, built from the terms in
// the notes you have reviewed.
//
// A stack rather than a list. The whole value of a flashcard is the moment
// before the answer, and a list destroys that moment for every card below
// the first — you read the answers on your way down. One card at a time,
// face down, is the only arrangement that preserves it.
//
// Tapping the card flips it. Next and Previous move through the stack, and
// they are separate controls on purpose: a tap that both reveals and
// advances makes it impossible to look at an answer twice, and going back
// to one you half-knew is most of how this gets used.
import { useCallback, useEffect, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { Layers, RotateCw, ArrowRight, ArrowLeft } from '../../ui/icons'
import { fetchDeck, dealDeck, type Deck } from './flashcardsApi'
import './flashcards.css'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="note-scroll">
      <div className="note-container fc-wrap">{children}</div>
    </div>
  )
}

export function FlashcardsView() {
  const user = useVault((s) => s.user)
  const openNote = useVault((s) => s.openNote)

  const [deck, setDeck] = useState<Deck | null>(null)
  const [notes, setNotes] = useState<number | null>(null)
  const [limit, setLimit] = useState(10)
  const [loading, setLoading] = useState(true)
  const [dealing, setDealing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [at, setAt] = useState(0)
  // Which cards have been turned over, by index. Kept for the whole deck
  // rather than reset on move: a card you have already seen the back of
  // should not pretend otherwise when you come back to it.
  const [flipped, setFlipped] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let cancelled = false
    fetchDeck()
      .then((t) => {
        if (cancelled) return
        setDeck(t.deck)
        setNotes(t.notes)
        setLimit(t.limit)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const total = deck?.cards.length ?? 0

  const go = useCallback(
    (delta: number) => setAt((i) => Math.min(total - 1, Math.max(0, i + delta))),
    [total],
  )
  const flip = useCallback(() => setFlipped((f) => ({ ...f, [at]: !f[at] })), [at])

  // A card you flip with a tap should flip with a key too, and arrows are
  // what a stack of anything is expected to answer to.
  useEffect(() => {
    if (!deck) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === ' ' || e.key === 'Enter') {
        // Only when nothing focusable owns the key, or Enter on the Next
        // button would flip the card instead of advancing.
        if (el instanceof HTMLButtonElement) return
        e.preventDefault()
        flip()
      } else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deck, go, flip])

  const start = async () => {
    if (dealing) return
    setDealing(true)
    setError(null)
    try {
      const d = await dealDeck()
      setDeck(d)
      setAt(0)
      setFlipped({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDealing(false)
    }
  }

  if (!user?.accessApproved) {
    return (
      <Shell>
        <div className="fc-empty">
          <span className="fc-empty-icon"><Layers width={28} height={28} /></span>
          <h1>Flashcards</h1>
          <p>Cards are made from your own notes, so this opens up once your account does.</p>
        </div>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="fc-empty"><span className="spinner" /></div>
      </Shell>
    )
  }

  // ── Nothing dealt yet ───────────────────────────────────────────────────
  if (!deck) {
    const enough = (notes ?? 0) > 0
    return (
      <Shell>
        <div className="fc-empty">
          <span className="fc-empty-icon"><Layers width={28} height={28} /></span>
          <h1>Today's cards</h1>
          {enough ? (
            <>
              <p>
                {limit} cards, drawn from the {notes} note{notes === 1 ? '' : 's'} you have
                reviewed — weighted towards the ones you rated least confident and most
                important.
              </p>
              {error && <div className="fc-error">{error}</div>}
              <button className="fc-btn primary" disabled={dealing} onClick={() => void start()}>
                {dealing ? <span className="spinner" /> : null}
                {dealing ? 'Picking your cards…' : 'Deal'}
              </button>
              <p className="fc-note">
                One deck a day. Tomorrow's draws again from whatever you have read by then.
              </p>
            </>
          ) : (
            <>
              <p>
                No cards yet. They come from the terms in notes you have reviewed — read one
                to the end and mark it reviewed, and this fills up.
              </p>
              {error && <div className="fc-error">{error}</div>}
            </>
          )}
        </div>
      </Shell>
    )
  }

  // ── The stack ───────────────────────────────────────────────────────────
  const card = deck.cards[at]
  const isFlipped = !!flipped[at]
  // The front is whichever side this card was dealt on; the back is the
  // other one. Mixing the direction is what stops the deck being a
  // vocabulary list read in one direction only.
  const seen = Object.values(flipped).filter(Boolean).length

  return (
    <Shell>
      <div className="fc-run">
        <div className="fc-progress">
          <span>
            Card {at + 1} of {total}
          </span>
          <span className="fc-progress-bar" aria-hidden="true">
            <span style={{ width: `${((at + 1) / total) * 100}%` }} />
          </span>
          <span className="fc-progress-seen">{seen} turned</span>
        </div>

        {/* The stack edges are two static layers behind the card. They say
            "there are more of these" without a card-shuffling animation
            that would fight the flip. */}
        <div className="fc-stack">
          {at < total - 1 && <span className="fc-stack-edge fc-stack-2" aria-hidden="true" />}
          {at < total - 2 && <span className="fc-stack-edge fc-stack-3" aria-hidden="true" />}

          <button
            type="button"
            className={'fc-card' + (isFlipped ? ' is-flipped' : '')}
            onClick={flip}
            aria-label={isFlipped ? 'Show the other side' : 'Reveal the other side'}
          >
            <span className="fc-card-inner">
              <span className="fc-face fc-front">
                <span className="fc-kind">{card.front === 'term' ? 'Term' : 'Definition'}</span>
                <span className={card.front === 'term' ? 'fc-term' : 'fc-def'}>
                  {card.front === 'term' ? card.term : card.definition}
                </span>
                <span className="fc-hint">Tap to flip</span>
              </span>
              <span className="fc-face fc-back">
                <span className="fc-kind">{card.front === 'term' ? 'Definition' : 'Term'}</span>
                <span className={card.front === 'term' ? 'fc-def' : 'fc-term'}>
                  {card.front === 'term' ? card.definition : card.term}
                </span>
                <span className="fc-hint">{card.noteTitle}</span>
              </span>
            </span>
          </button>
        </div>

        <div className="fc-controls">
          <button className="fc-btn" disabled={at === 0} onClick={() => go(-1)}>
            <ArrowLeft width={15} height={15} /> Previous
          </button>
          <button className="fc-btn" disabled={at >= total - 1} onClick={() => go(1)}>
            Next <ArrowRight width={15} height={15} />
          </button>
        </div>

        {/* The note is the point: a term you could not place should be one
            tap from the thing that explains it. */}
        <button className="fc-source" onClick={() => openNote(card.notePath)}>
          From {card.noteTitle}
        </button>

        {at >= total - 1 && (
          <p className="fc-note">
            <RotateCw width={13} height={13} /> That's today's {total}. A new deck tomorrow.
          </p>
        )}
      </div>
    </Shell>
  )
}
