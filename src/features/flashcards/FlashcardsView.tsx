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
import { Layers, RotateCw, ArrowRight, ArrowLeft, Check, Bookmark, BookmarkFilled } from '../../ui/icons'
import { fetchDeck, dealDeck, turnCard, bookmarkCard, type Deck, type TurnResult } from './flashcardsApi'
import './flashcards.css'

/** The bookmark, rendered once per face.
 *
 *  Two elements, one value: `on` and `onToggle` come from the same state
 *  either side, so there is nothing to keep in step — the duplication is in
 *  the DOM, where the flip needs it, and not in the data.
 */
function BookmarkButton({
  on,
  onToggle,
  reachable,
}: {
  on: boolean
  onToggle: () => void
  /** False on the face turned away: it is inside an aria-hidden subtree and
   *  must not be tabbable from there. */
  reachable: boolean
}) {
  return (
    <button
      type="button"
      className={'fc-bookmark' + (on ? ' is-on' : '')}
      tabIndex={reachable ? 0 : -1}
      aria-pressed={on}
      title={on ? 'Bookmarked — back tomorrow' : 'See this one again tomorrow'}
      aria-label={on ? 'Remove bookmark' : 'Bookmark to see again tomorrow'}
      // The card behind is one big flip target; without this every bookmark
      // tap would also turn the card over.
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {on ? <BookmarkFilled width={17} height={17} /> : <Bookmark width={17} height={17} />}
    </button>
  )
}

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
  // Which face is showing, by index. Purely visual and purely local — it is
  // not the same fact as "has this been turned over", which is the deck's
  // `turnedAt` and lives on the server. Conflating the two is what made
  // flipping a card back count as un-seeing it.
  const [flipped, setFlipped] = useState<Record<number, boolean>>({})
  // The scheduler's reply, by index. Only for cards turned in this sitting —
  // a card turned on an earlier visit is still marked reviewed, just without
  // the "back in N days", which is not worth a second request to recover.
  const [scheduled, setScheduled] = useState<Record<number, TurnResult>>({})

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
  // Flip is instant and local; recording the turn is a request. The card
  // must not wait for the network to move, and a failed record must not
  // leave the user looking at a card that refuses to turn — so the write is
  // fire-and-forget and the count is corrected from its reply.
  const toggleBookmark = useCallback(() => {
    if (!deck) return
    const next = !deck.bookmarked[at]
    // Optimistic: a bookmark is a small, reversible thing and the control
    // should answer the tap, not the round trip.
    setDeck((d) => (d ? { ...d, bookmarked: d.bookmarked.map((b, i) => (i === at ? next : b)) } : d))
    void bookmarkCard(at, next).catch(() => {
      setDeck((d) => (d ? { ...d, bookmarked: d.bookmarked.map((b, i) => (i === at ? !next : b)) } : d))
    })
  }, [at, deck])

  const flip = useCallback(() => {
    setFlipped((f) => ({ ...f, [at]: !f[at] }))
    const card = deck?.cards[at]
    if (!card || card.turnedAt) return
    // Optimistic, so the counter moves with the card rather than a beat later.
    setDeck((d) =>
      d
        ? { ...d, cards: d.cards.map((c, i) => (i === at ? { ...c, turnedAt: new Date().toISOString() } : c)) }
        : d,
    )
    void turnCard(at)
      .then((r) => setScheduled((m) => ({ ...m, [at]: r })))
      .catch(() => {
      // Put it back: a card the server does not know was turned will be
      // dealt again, and the count should say so rather than quietly
      // disagreeing with tomorrow's deck.
        setDeck((d) => (d ? { ...d, cards: d.cards.map((c, i) => (i === at ? { ...c, turnedAt: null } : c)) } : d))
      })
  }, [at, deck])

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
  const bookmarked = deck.bookmarked[at] ?? false
  // The front is whichever side this card was dealt on; the back is the
  // other one. Mixing the direction is what stops the deck being a
  // vocabulary list read in one direction only.
  // Counted from the deck, not from `flipped`: turning a card back used to
  // decrement this, so a card looked at twice reported "0 turned".
  const seen = deck.cards.filter((c) => c.turnedAt != null).length

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

          {/* One bookmark per face, both reading and writing the same
              `bookmarked` value — so they cannot disagree, and the control
              rotates with the card instead of hovering over it.

              The card is a div with role="button" rather than a <button>
              for exactly this: a button's content model is phrasing
              content, so a button inside one is invalid HTML and browsers
              are entitled to reparent it, which breaks the 3D flip in ways
              that only show up in one engine. */}
          <div
            role="button"
            tabIndex={0}
            className={'fc-card' + (isFlipped ? ' is-flipped' : '')}
            onClick={flip}
            aria-label={isFlipped ? 'Show the other side' : 'Reveal the other side'}
          >
            <span className="fc-card-inner">
              {/* The face turned away is hidden from assistive tech as well
                  as visually: without this a screen reader reads the term
                  and its definition in one breath, which is the one thing a
                  flashcard must not do. Its bookmark leaves the tab order
                  with it — focusable content inside aria-hidden is worse
                  than either problem alone. */}
              <span className="fc-face fc-front" aria-hidden={isFlipped}>
                <BookmarkButton on={bookmarked} onToggle={toggleBookmark} reachable={!isFlipped} />
                {/* The text scrolls, the bookmark does not. An absolutely
                    positioned child of a scrolling box scrolls with it, so
                    an overlong definition would carry the control off the
                    top of the card. */}
                <span className="fc-face-body">
                  <span className="fc-kind">{card.front === 'term' ? 'Term' : 'Definition'}</span>
                  <span className={card.front === 'term' ? 'fc-term' : 'fc-def'}>
                    {card.front === 'term' ? card.term : card.definition}
                  </span>
                  <span className="fc-hint">Tap to flip</span>
                </span>
              </span>
              <span className="fc-face fc-back" aria-hidden={!isFlipped}>
                <BookmarkButton on={bookmarked} onToggle={toggleBookmark} reachable={isFlipped} />
                <span className="fc-face-body">
                  <span className="fc-kind">{card.front === 'term' ? 'Definition' : 'Term'}</span>
                  <span className={card.front === 'term' ? 'fc-def' : 'fc-term'}>
                    {card.front === 'term' ? card.definition : card.term}
                  </span>
                  <span className="fc-hint">{card.noteTitle}</span>
                </span>
              </span>
            </span>
          </div>
        </div>

        <div className="fc-controls">
          <button className="fc-btn" disabled={at === 0} onClick={() => go(-1)}>
            <ArrowLeft width={15} height={15} /> Previous
          </button>
          <button className="fc-btn" disabled={at >= total - 1} onClick={() => go(1)}>
            Next <ArrowRight width={15} height={15} />
          </button>
        </div>

        <div className="fc-meta">
          {/* Marked from the first turn and never unmarked — the card has
              been seen, and flipping it back does not undo that. */}
          {card.turnedAt && (
            <span className="fc-reviewed">
              <Check width={12} height={12} /> Reviewed
              {/* A bookmark overrides the interval, so saying "back in 8
                  days" next to a bookmarked card would be a lie. */}
              {scheduled[at] && !bookmarked && ` · back in ${scheduled[at].intervalDays} days`}
            </span>
          )}
          {bookmarked && <span className="fc-bookmarked-note">Back tomorrow</span>}
          {/* The note is the point: a term you could not place should be one
              tap from the thing that explains it. */}
          <button className="fc-source" onClick={() => openNote(card.notePath)}>
            From {card.noteTitle}
          </button>
        </div>

        {at >= total - 1 && (
          <p className="fc-note">
            <RotateCw width={13} height={13} /> That's today's {total}. A new deck tomorrow.
          </p>
        )}
      </div>
    </Shell>
  )
}
