import { useEffect, useRef } from 'react'
import { useVault } from '../../vault/vaultStore'
import { slugify } from '../../vault/parse'
import { MarkdownView } from './MarkdownView'
import { Properties } from './Properties'
import { Editor } from '../editor/Editor'
import './noteview.css'

function stripLeadingTitle(body: string, title: string): string {
  const m = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/)
  if (m && m[1].trim() === title.trim()) return body.slice(m[0].length)
  return body
}

export function NoteView({ path, heading }: { path: string; heading?: string }) {
  const note = useVault((s) => s.getNote(path))
  const mode = useVault((s) => s.mode)
  const openTag = useVault((s) => s.setSearchOpen)
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

  return (
    <div className="note-scroll" ref={scrollRef}>
      <div className="note-container">
        <h1 className="note-title">{note.title}</h1>
        {note.tags.length > 0 && (
          <div className="note-tags">
            {note.tags.map((t) => (
              <span key={t} className="tag" onClick={() => openTag(true)}>
                #{t}
              </span>
            ))}
          </div>
        )}
        <Properties frontmatter={note.frontmatter} />
        <MarkdownView content={body} notePath={note.path} />
      </div>
    </div>
  )
}
