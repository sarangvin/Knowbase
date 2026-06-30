// Remark plugin: rewrite Obsidian [[wikilinks]] and ![[embeds]] in `text` nodes
// into mdast link/image nodes with custom URL schemes the renderer understands:
//   [[Target#Heading|Alias]]  -> link  url="wikilink:<enc target>#<enc heading>"
//   ![[image.png]]            -> image url="wikiembed:<enc path>"
//   ![[Some Note]]            -> link  url="wikiembednote:<enc target>"
// Operating on `text` nodes only means code blocks/inline code are never touched.
import { parseLinkInner } from '../../vault/parse'

interface MdNode {
  type: string
  value?: string
  url?: string
  alt?: string
  children?: MdNode[]
  [k: string]: unknown
}

const WIKILINK_RE = /(!?)\[\[([^\]]+?)\]\]/g
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i

function isImage(target: string) {
  return IMAGE_EXT.test(target)
}

function buildReplacement(embed: boolean, inner: string): MdNode {
  const { target, alias, heading } = parseLinkInner(inner, embed)
  if (embed && isImage(target)) {
    return { type: 'image', url: `wikiembed:${encodeURIComponent(target)}`, alt: alias ?? target }
  }
  if (embed) {
    return {
      type: 'link',
      url: `wikiembednote:${encodeURIComponent(target)}`,
      children: [{ type: 'text', value: alias ?? target }],
    }
  }
  const frag = heading ? `#${encodeURIComponent(heading)}` : ''
  return {
    type: 'link',
    url: `wikilink:${encodeURIComponent(target)}${frag}`,
    children: [{ type: 'text', value: alias ?? target }],
  }
}

function splitTextNode(node: MdNode): MdNode[] | null {
  const value = node.value ?? ''
  WIKILINK_RE.lastIndex = 0
  if (!WIKILINK_RE.test(value)) return null
  WIKILINK_RE.lastIndex = 0
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(value)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    out.push(buildReplacement(m[1] === '!', m[2]))
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function walk(node: MdNode) {
  if (!node.children) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      const split = splitTextNode(child)
      if (split) {
        next.push(...split)
        continue
      }
    }
    walk(child)
    next.push(child)
  }
  node.children = next
}

export function remarkWikiLink() {
  return (tree: MdNode) => walk(tree)
}
