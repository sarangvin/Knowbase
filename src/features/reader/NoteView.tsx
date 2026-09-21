import { useEffect, useRef } from 'react'
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

  // "My Notes" is rendered as an editor rather than as markdown, so the body
  // is split around it: prose before, the box, prose after. Split on the
  // rendered body rather than the raw note so the offsets line up with what
  // MarkdownView is given — the frontmatter and any stripped title are
  // already gone from this string.
  // Two sections are components rather than markdown: My Notes is an editor,
  // and Questions has a button per question. Both draw their own heading, so
  // each split stops where its heading starts.
  const mine = extractSection(body, 'My Notes')
  const mineStart = mine ? body.lastIndexOf('##', mine.contentStart) : -1
  const qs = questionsSection(body)
  const qsStart = qs ? body.lastIndexOf('##', qs.start) : -1
  const questions = qs ? parseQuestions(body) : []

  // Rendered in document order. Questions follows My Notes in the template,
  // and a note that has been edited by hand could have them either way
  // round — so the middle slice is whatever sits between them.
  const hasBoth = mineStart >= 0 && qsStart >= 0
  const mineFirst = hasBoth ? mineStart < qsStart : mineStart >= 0

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
        {hasBoth ? (
          mineFirst ? (
            <>
              <MarkdownView content={body.slice(0, mineStart)} notePath={note.path} />
              <MyNotes note={note} initial={mine!.text.trim()} />
              <MarkdownView content={body.slice(mine!.contentEnd, qsStart)} notePath={note.path} />
              <Questions note={note} items={questions} />
              <MarkdownView content={body.slice(qs!.end)} notePath={note.path} />
            </>
          ) : (
            <>
              <MarkdownView content={body.slice(0, qsStart)} notePath={note.path} />
              <Questions note={note} items={questions} />
              <MarkdownView content={body.slice(qs!.end, mineStart)} notePath={note.path} />
              <MyNotes note={note} initial={mine!.text.trim()} />
              <MarkdownView content={body.slice(mine!.contentEnd)} notePath={note.path} />
            </>
          )
        ) : mineStart >= 0 ? (
          <>
            <MarkdownView content={body.slice(0, mineStart)} notePath={note.path} />
            <MyNotes note={note} initial={mine!.text.trim()} />
            <MarkdownView content={body.slice(mine!.contentEnd)} notePath={note.path} />
          </>
        ) : qsStart >= 0 ? (
          <>
            <MarkdownView content={body.slice(0, qsStart)} notePath={note.path} />
            <Questions note={note} items={questions} />
            <MarkdownView content={body.slice(qs!.end)} notePath={note.path} />
          </>
        ) : (
          <MarkdownView content={body} notePath={note.path} />
        )}
      </div>
      {/* Outside .note-container on purpose: as a sibling it can stick to the
          foot of the scroller for the whole note, rather than only once the
          container's own bottom edge comes into view. */}
      <ReviewBar note={note} scrollRef={scrollRef} />
    </div>
  )
}
