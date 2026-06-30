import { useEffect, useState, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkWikiLink } from './remarkWikiLink'
import { getBlockRenderer } from './blockRenderers'
import { useVault } from '../../vault/vaultStore'
import { slugify } from '../../vault/parse'
import './markdown.css'

const MAX_EMBED_DEPTH = 3

/** Resolves an asset path (image embed) to a displayable URL via the source. */
function AssetImage({ target, alt }: { target: string; alt?: string }) {
  const source = useVault((s) => s.source)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let alive = true
    const path = resolveAssetPath(target, useVault.getState())
    if (!source || !path) {
      setFailed(true)
      return
    }
    source
      .assetUrl(path)
      .then((u) => {
        if (!alive) return
        if (u.startsWith('blob:')) revoked = u
        setUrl(u)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      if (revoked) URL.revokeObjectURL(revoked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, source])

  if (failed) return <span className="embed-missing">!{`[[${target}]]`}</span>
  if (!url) return <span className="embed-loading" />
  return <img className="md-embed-img" src={url} alt={alt ?? target} loading="lazy" />
}

function resolveAssetPath(target: string, state: ReturnType<typeof useVault.getState>): string | null {
  const dec = decodeURIComponent(target)
  // assets aren't in the note index; match by path suffix against the file list
  const exact = state.files.find((f) => f.path === dec || f.path.endsWith('/' + dec))
  if (exact) return exact.path
  const base = dec.split('/').pop()!.toLowerCase()
  return state.files.find((f) => f.path.toLowerCase().endsWith('/' + base) || f.path.toLowerCase() === base)?.path ?? null
}

/** A transcluded note embed (![[Note]]). Renders the target's body inline. */
function NoteEmbed({ target, depth }: { target: string; depth: number }) {
  const resolveLink = useVault((s) => s.resolveLink)
  const getNote = useVault((s) => s.getNote)
  const openNote = useVault((s) => s.openNote)
  const path = resolveLink(decodeURIComponent(target))
  const note = path ? getNote(path) : undefined
  if (!note) return <span className="embed-missing">!{`[[${decodeURIComponent(target)}]]`}</span>
  return (
    <div className="note-embed">
      <div className="note-embed-title" onClick={() => openNote(note.path)}>
        {note.title}
      </div>
      <div className="note-embed-body">
        {depth >= MAX_EMBED_DEPTH ? (
          <span className="text-faint">(embed depth limit)</span>
        ) : (
          <Markdown content={note.body} depth={depth + 1} notePath={note.path} />
        )}
      </div>
    </div>
  )
}

/** Internal wikilink — styled resolved/unresolved, click to navigate. */
function WikiLink({ url, children }: { url: string; children: ReactNode }) {
  const openNote = useVault((s) => s.openNote)
  const resolveLink = useVault((s) => s.resolveLink)
  const raw = url.slice('wikilink:'.length)
  const [targetEnc, headingEnc] = raw.split('#')
  const target = decodeURIComponent(targetEnc)
  const heading = headingEnc ? decodeURIComponent(headingEnc) : undefined
  const path = resolveLink(target)
  return (
    <a
      className={path ? 'internal-link' : 'internal-link is-unresolved'}
      onClick={(e) => {
        e.preventDefault()
        if (path) openNote(path, { heading })
      }}
      title={path ? target : `${target} (not created)`}
    >
      {children}
    </a>
  )
}

interface MarkdownProps {
  content: string
  depth?: number
  /** Path of the note this content belongs to (used by dashboard block renderers). */
  notePath?: string
}

export function Markdown({ content, depth = 0, notePath = '' }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkWikiLink]}
      urlTransform={(url) => url}
      components={{
        a({ href, children }) {
          const url = href ?? ''
          if (url.startsWith('wikilink:')) return <WikiLink url={url}>{children}</WikiLink>
          if (url.startsWith('wikiembednote:'))
            return <NoteEmbed target={url.slice('wikiembednote:'.length)} depth={depth} />
          const external = /^https?:/i.test(url)
          return (
            <a href={url} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
              {children}
            </a>
          )
        },
        img({ src, alt }) {
          const url = typeof src === 'string' ? src : ''
          if (url.startsWith('wikiembed:'))
            return <AssetImage target={url.slice('wikiembed:'.length)} alt={alt} />
          return <img src={url} alt={alt} className="md-embed-img" loading="lazy" />
        },
        pre({ children }) {
          // Replace a whole ```lang block with a registered renderer (e.g.
          // dataviewjs dashboards) — otherwise fall back to a normal <pre>.
          const child = Array.isArray(children) ? children[0] : children
          if (isValidElement(child)) {
            const props = child.props as { className?: string; children?: ReactNode }
            const lang = /language-(\w+)/.exec(props.className ?? '')?.[1]
            if (lang) {
              const renderer = getBlockRenderer(lang)
              if (renderer) {
                return <>{renderer({ source: String(props.children ?? ''), notePath, lang })}</>
              }
            }
          }
          return <pre>{children}</pre>
        },
        h1: (p) => <h1 id={slugify(textOf(p.children))}>{p.children}</h1>,
        h2: (p) => <h2 id={slugify(textOf(p.children))}>{p.children}</h2>,
        h3: (p) => <h3 id={slugify(textOf(p.children))}>{p.children}</h3>,
        h4: (p) => <h4 id={slugify(textOf(p.children))}>{p.children}</h4>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (children && typeof children === 'object' && 'props' in (children as { props?: { children?: ReactNode } }))
    return textOf((children as { props: { children?: ReactNode } }).props.children)
  return ''
}

/** Top-level rendered note body with the `.markdown-rendered` container. */
export function MarkdownView({ content, notePath }: { content: string; notePath?: string }) {
  return (
    <div className="markdown-rendered">
      <Markdown content={content} notePath={notePath} />
    </div>
  )
}
