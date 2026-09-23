import { Fragment, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useVault } from '../../vault/vaultStore'
import { slugify } from '../../vault/parse'
import { MarkdownView } from './MarkdownView'
import { Properties } from './Properties'
import { ReviewBar } from './ReviewBar'
import { Editor } from '../editor/Editor'
import { MyNotes } from './MyNotes'
import { Questions } from './Questions'
import { parseQuestions, questionsSection } from './questionsFormat'
import { extractSection } from '../sync/sync'
import './noteview.css'

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
  //   reading, and deliberately above the optional exercises below it
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
  const mineStart = mine ? body.lastIndexOf('##', mine.contentStart) : -1
  const qs = questionsSection(body)
  const qsStart = qs ? body.lastIndexOf('##', qs.start) : -1

  const inserts: { start: number; end: number; node: ReactNode }[] = []
  if (ai) inserts.push({ start: ai.contentEnd, end: ai.contentEnd, node: <ReviewBar note={note} /> })
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
    <div className="note-scroll" ref={scrollRef}>
      <div className="note-container">
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
        {!ai && <ReviewBar note={note} />}
      </div>
    </div>
  )
}
