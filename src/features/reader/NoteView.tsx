import { Fragment, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useVault } from '../../vault/vaultStore'
import { slugify } from '../../vault/parse'
import { MarkdownView } from './MarkdownView'
import { Properties } from './Properties'
import { ReviewBar } from './ReviewBar'
import { useCardThrow } from './useCardThrow'
import { INTERESTED, NOT_INTERESTED, useFinishNote, useTouchPrimary } from './useFinishNote'
import { Editor } from '../editor/Editor'
import { MyNotes } from './MyNotes'
import { Questions } from './Questions'
import { parseQuestions, questionsSection } from './questionsFormat'
import { extractSection } from '../../vault/sections'
import { FindSources } from './FindSources'
import { HighlightBar } from '../highlight/HighlightBar'
import './noteview.css'

/** Keep clear of the screen edges: a swipe that starts there is the
 *  browser's back/forward gesture, and taking it would break navigation. */
const EDGE_PX = 24
/** Things inside a note that own a sideways drag themselves: fields you type
 *  in, sliders, and blocks wide enough to scroll. */
const NO_SWIPE = 'input, textarea, select, [contenteditable="true"], pre, table, .reviewsheet'

/** Whether a press on the note may start throwing it. Touch only — on a
 *  desktop the note is a page, and dragging a page sideways with a mouse is
 *  a text selection. */
function acceptNoteSwipe(e: ReactPointerEvent<HTMLElement>): boolean {
  if (e.pointerType !== 'touch') return false
  if (e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX) return false
  const target = e.target instanceof Element ? e.target : null
  if (!target || target.closest(NO_SWIPE)) return false
  // A horizontally scrollable block inside the note — a wide table wrapper,
  // a long line of code — gets its own sideways drags.
  for (let el: Element | null = target; el && el !== e.currentTarget; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return false
    }
  }
  return true
}

function stripLeadingTitle(body: string, title: string): string {
  const m = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/)
  if (m && m[1].trim() === title.trim()) return body.slice(m[0].length)
  return body
}

export function NoteView({ path, heading }: { path: string; heading?: string }) {
  const note = useVault((s) => s.getNote(path))
  const mode = useVault((s) => s.mode)
  const openView = useVault((s) => s.openView)
  const scrollRef = useRef<HTMLDivElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)

  // Finishing this note — shared by the review button, the swipe-up sheet,
  // the card they open, and the note itself (below). One owner, so they
  // cannot disagree about whether it is done.
  const touch = useTouchPrimary()
  const finisher = useFinishNote(note, touch)

  // On a phone the note is the top card of the deck: throw it right for more
  // like this, left for not, and the note Next Up would pick is revealed
  // underneath and opened. Same physics as the finish card, but locked to
  // sideways drags so reading and scrolling are untouched, and a far smaller
  // tilt — a whole page swinging 14 degrees looks like it is falling over.
  const swipeable = touch && finisher.canFinish && mode !== 'edit'
  const deck = useCardThrow({
    enabled: swipeable,
    widthOf: () => deckRef.current?.offsetWidth ?? window.innerWidth,
    yDamp: 0.12,
    maxTilt: 5,
    axisLock: true,
    accept: acceptNoteSwipe,
    onThrown: (dir) => {
      void finisher.finish(dir === 'right' ? INTERESTED : NOT_INTERESTED, { swiped: true }).then((ok) => {
        // Saved: the next note is arriving in this same element, so put it
        // back without an animation. Failed: bring this note back into view
        // with the spring, and the review sheet says what went wrong.
        if (ok) deck.reset(true)
        else deck.reset()
      })
    },
  })
  const live = deck.dragging || !!deck.thrown || deck.pos.x !== 0

  // A different note in this element: whatever was mid-flight belonged to the
  // last one. Cancelling it here also cancels its pending save — without
  // this, going back during the moment a throw is landing would finish the
  // note you went back to.
  const resetDeck = deck.reset
  useEffect(() => resetDeck(true), [path, resetDeck])

  // Scroll to a linked heading when navigating to [[Note#Heading]].
  useEffect(() => {
    if (!heading || mode === 'edit') return
    const id = slugify(decodeURIComponent(heading))
    const el = scrollRef.current?.querySelector(`#${CSS.escape(id)}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else scrollRef.current?.scrollTo({ top: 0 })
  }, [path, heading, mode, note])

  // Reset scroll on note change (when no heading target).
  useEffect(() => {
    if (!heading) scrollRef.current?.scrollTo({ top: 0 })
  }, [path, heading])

  if (!note) {
    return (
      <div className="note-scroll">
        <div className="note-container">
          <div className="empty-state">Note not found: {path}</div>
        </div>
      </div>
    )
  }

  if (mode === 'edit') return <Editor notePath={path} />

  // Avoid showing the title twice: if the body opens with an H1 equal to the
  // note title (common in this vault), drop that leading H1 from the rendered body.
  const body = stripLeadingTitle(note.body, note.title)

  // Three things in a topic note are components rather than markdown, and
  // each has to be spliced into the prose at the right offset:
  //
  //   the review control, at the foot of "AI Notes" — the end of the
  //   reading, and deliberately above the optional exercises below it. On
  //   touch it also portals a swipe sheet to the foot of the scroller, so
  //   a reader who does work through the questions can finish from there
  //   too; see ReviewBar.tsx
  //   "My Notes", which is an editor
  //   "Questions", which has a button per question
  //
  // Offsets are taken against the *rendered* body rather than the raw note,
  // so they line up with what MarkdownView is handed — the frontmatter and
  // any stripped title are already gone from this string. My Notes and
  // Questions each draw their own heading, so their slices start where the
  // heading starts; the review control has no heading and is a pure
  // insertion point, so it starts and ends at the same offset.
  //
  // Built as a sorted list rather than as a nest of orderings. The template
  // puts these in one order, but a note edited by hand can have them in any,
  // and enumerating the permutations is how a branch nobody tested renders
  // the same paragraph twice.
  const ai = extractSection(body, 'AI Notes')
  const mine = extractSection(body, 'My Notes')
  const links = extractSection(body, 'Useful Links')
  const mineStart = mine ? body.lastIndexOf('##', mine.contentStart) : -1
  const qs = questionsSection(body)
  const qsStart = qs ? body.lastIndexOf('##', qs.start) : -1

  const inserts: { start: number; end: number; node: ReactNode }[] = []
  if (ai)
    inserts.push({
      start: ai.contentEnd,
      end: ai.contentEnd,
      node: <ReviewBar note={note} scrollRef={scrollRef} finisher={finisher} touch={touch} />,
    })
  // "Find sources" at the foot of Useful Links, below whatever is there.
  if (links)
    inserts.push({
      start: links.contentEnd,
      end: links.contentEnd,
      node: <FindSources note={note} />,
    })
  if (mine && mineStart >= 0) {
    inserts.push({
      start: mineStart,
      end: mine.contentEnd,
      node: <MyNotes note={note} initial={mine.text.trim()} />,
    })
  }
  if (qs && qsStart >= 0) {
    inserts.push({ start: qsStart, end: qs.end, node: <Questions note={note} items={parseQuestions(body)} /> })
  }
  inserts.sort((a, b) => a.start - b.start)

  const blocks: ReactNode[] = []
  let cursor = 0
  inserts.forEach((ins, i) => {
    // An empty slice still renders a <MarkdownView>, which is harmless, but
    // skipping it keeps the DOM honest about what the note contains.
    if (ins.start > cursor) {
      blocks.push(<MarkdownView key={`md${i}`} content={body.slice(cursor, ins.start)} notePath={note.path} />)
    }
    blocks.push(<Fragment key={`c${i}`}>{ins.node}</Fragment>)
    cursor = Math.max(cursor, ins.end)
  })
  if (cursor < body.length) {
    blocks.push(<MarkdownView key="md-last" content={body.slice(cursor)} notePath={note.path} />)
  }

  return (
    <div
      ref={deckRef}
      className={
        'note-deck' +
        (swipeable ? ' is-swipeable' : '') +
        (live ? ' is-live' : '') +
        (deck.dragging ? ' is-dragging' : '') +
        (deck.thrown ? ' is-thrown' : '') +
        (deck.instant ? ' is-instant' : '')
      }
      style={deck.vars}
    >
      {/* What finishing sends you to, under the note, rising into place as
          the note is pulled off it. Only there while it could be seen. */}
      {(swipeable || deck.thrown) && (
        <div className="note-under" aria-hidden="true">
          <div className="note-under-page">
            <div className="note-under-eyebrow">
              {finisher.next?.kind === 'review' ? 'Up next · review' : 'Up next'}
            </div>
            <div className="note-under-title">{finisher.next ? finisher.next.title : 'Back to Next Up'}</div>
            <div className="note-under-hint">
              {!finisher.next
                ? 'Nothing new is ready yet — new topics are written as you finish these'
                : finisher.next.pending
                  ? 'Still being written — it will be ready shortly'
                  : 'Opens when this one goes'}
            </div>
          </div>
        </div>
      )}
    <div className="note-scroll" ref={scrollRef} {...deck.handlers}>
      <div className="note-container">
        <HighlightBar notePath={note.path} />
        <h1 className="note-title">{note.title}</h1>
        {note.tags.length > 0 && (
          <div className="note-tags">
            {note.tags.map((t) => (
              <span key={t} className="tag" onClick={() => openView({ kind: 'search' })}>
                #{t}
              </span>
            ))}
          </div>
        )}
        <Properties frontmatter={note.frontmatter} notePath={note.path} />
        {blocks}
        {/* A note with no "AI Notes" section — a hand-written one, or one
            whose template has drifted — still needs a way to be reviewed, so
            the control falls back to the end of the note. */}
        {!ai && <ReviewBar note={note} scrollRef={scrollRef} finisher={finisher} touch={touch} />}
      </div>
    </div>
      {/* Inked onto the note as it moves, on the side it is leaving from. A
          separate layer, moved with the same transform, because inside the
          scroller they would scroll away with the text. */}
      {swipeable && (
        <div className="note-stamps" aria-hidden="true">
          <span className="note-stamp note-stamp-yes" style={{ opacity: Math.max(0, deck.lean) }}>
            More like this
          </span>
          <span className="note-stamp note-stamp-no" style={{ opacity: Math.max(0, -deck.lean) }}>
            Not for me
          </span>
        </div>
      )}
    </div>
  )
}
