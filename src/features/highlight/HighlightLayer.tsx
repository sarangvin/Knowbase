// The highlighter itself: the app's own selection, drawn over the note,
// instead of the phone's.
//
// The system selection was the wrong tool. On a phone it brings its own
// handles and a Copy / Look Up menu over the words, it selects by letter
// rather than by word, and a tap meant to start a highlight follows the link
// under it instead. While highlight mode is on the note's text is not
// selectable at all (highlight.css) and this does the selecting:
//
//   - tap a word and the whole word is marked, in orange;
//   - drag the handle at either end of the mark to take in more words or
//     fewer, always whole words, within the same paragraph, up to the
//     server's limit of MAX_WORDS;
//   - the words marked go to the store, and the highlighter button's second
//     tap turns them into a note, exactly as before.
//
// The marks are positioned boxes laid over the text, in the note's own
// coordinates, so they scroll with it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHighlight } from './highlightStore'

/** Mirrors MAX_HIGHLIGHT_WORDS in backend/src/notes/highlight.ts. */
const MAX_WORDS = 12

/** Where a highlight may start: prose, not headings, questions or the
 *  editor. The server only looks in AI Notes; anywhere else it says so. */
const BLOCK = 'p, li, blockquote'

interface Caret {
  node: Text
  offset: number
}

const WORD_CHAR = /[\p{L}\p{N}'’-]/u

/** The text position under a point, in whichever API this browser has. */
function caretAt(x: number, y: number): Caret | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let offset = 0
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (p) ({ offsetNode: node, offset } = p)
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    if (r) {
      node = r.startContainer
      offset = r.startOffset
    }
  }
  return node && node.nodeType === Node.TEXT_NODE ? { node: node as Text, offset } : null
}

/** The whole word around a caret, or null if the caret is not on one. */
function wordAt(c: Caret): { start: number; end: number } | null {
  const t = c.node.data
  let start = c.offset
  let end = c.offset
  // A caret just past the last letter of a word still means that word.
  if (!WORD_CHAR.test(t[start] ?? '') && WORD_CHAR.test(t[start - 1] ?? '')) start = end = start - 1
  if (!WORD_CHAR.test(t[start] ?? '')) return null
  while (start > 0 && WORD_CHAR.test(t[start - 1])) start--
  while (end < t.length && WORD_CHAR.test(t[end])) end++
  return { start, end }
}

function blockOf(node: Node, root: Element): Element | null {
  const el = node.parentElement?.closest(BLOCK)
  return el && root.contains(el) ? el : null
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export function HighlightLayer() {
  const { active, busy, capture } = useHighlight()
  const layerRef = useRef<HTMLDivElement>(null)
  const rangeRef = useRef<Range | null>(null)
  const [boxes, setBoxes] = useState<{ x: number; y: number; w: number; h: number }[]>([])

  const root = () => layerRef.current?.parentElement ?? null

  /** Redraw the marks from the current range, in the note's coordinates.
   *  `scale` undoes the text-size zoom: client rects are in screen pixels,
   *  the boxes are positioned in the note's own. */
  const draw = useCallback(() => {
    const r = rangeRef.current
    const container = root()
    if (!r || !container) return setBoxes([])
    const c = container.getBoundingClientRect()
    const scale = container.offsetWidth / (c.width || 1)
    const rects = [...r.getClientRects()].filter((q) => q.width > 0.5)
    setBoxes(rects.map((q) => ({ x: (q.left - c.left) * scale, y: (q.top - c.top) * scale, w: q.width * scale, h: q.height * scale })))
  }, [])

  const set = useCallback(
    (r: Range | null) => {
      rangeRef.current = r
      capture(r ? r.toString().replace(/\s+/g, ' ').trim() : '')
      draw()
    },
    [capture, draw],
  )

  // Off: forget the mark.
  useEffect(() => {
    if (!active) {
      rangeRef.current = null
      setBoxes([])
    }
  }, [active])

  // The text reflows on resize and on a text-size change; the marks follow.
  useLayoutEffect(() => {
    if (!active) return
    const onResize = () => draw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active, draw])

  // A tap on a word marks that word. A drag is a scroll and is left alone;
  // a tap on a link does not follow it while highlighting.
  useEffect(() => {
    const container = root()
    if (!active || !container) return
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest('.hl-handle')) return
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      if (!down || busy) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 8) return
      const c = caretAt(e.clientX, e.clientY)
      if (!c || !blockOf(c.node, container)) return
      const w = wordAt(c)
      if (!w) return
      const r = document.createRange()
      r.setStart(c.node, w.start)
      r.setEnd(c.node, w.end)
      set(r)
    }
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest('a')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    container.addEventListener('pointerdown', onDown)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('click', onClick, true)
    return () => {
      container.removeEventListener('pointerdown', onDown)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('click', onClick, true)
    }
  }, [active, busy, set])

  /** Drag a handle: the front one moves the start to the start of the word
   *  under the finger, the back one moves the end to its end. Never past the
   *  other end, never out of the paragraph, never over the word limit. */
  const dragHandle = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    const container = root()
    const r0 = rangeRef.current
    if (!container || !r0 || busy) return
    e.preventDefault()
    e.stopPropagation()
    const block = blockOf(r0.startContainer, container)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      // Aim a little above the finger, which covers the very text it points at.
      const c = caretAt(ev.clientX, ev.clientY - 14)
      if (!c || !block || !block.contains(c.node)) return
      const w = wordAt(c)
      if (!w) return
      const r = (rangeRef.current ?? r0).cloneRange()
      const probe = document.createRange()
      if (which === 'start') {
        probe.setStart(c.node, w.start)
        probe.collapse(true)
        if (probe.compareBoundaryPoints(Range.START_TO_END, r) >= 0) return
        r.setStart(c.node, w.start)
      } else {
        probe.setStart(c.node, w.end)
        probe.collapse(true)
        if (probe.compareBoundaryPoints(Range.START_TO_START, r) <= 0) return
        r.setEnd(c.node, w.end)
      }
      if (wordCount(r.toString()) > MAX_WORDS) return
      set(r)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const first = boxes[0]
  const last = boxes[boxes.length - 1]

  return (
    <div ref={layerRef} className="hl-layer" aria-hidden="true">
      {boxes.map((b, i) => (
        <div key={i} className="hl-mark" style={{ left: b.x - 2, top: b.y, width: b.w + 4, height: b.h }} />
      ))}
      {first && !busy && (
        <div className="hl-handle hl-handle-start" style={{ left: first.x - 2, top: first.y, height: first.h }} onPointerDown={dragHandle('start')}>
          <span className="hl-knob" />
        </div>
      )}
      {last && !busy && (
        <div className="hl-handle hl-handle-end" style={{ left: last.x + last.w + 2, top: last.y, height: last.h }} onPointerDown={dragHandle('end')}>
          <span className="hl-knob" />
        </div>
      )}
    </div>
  )
}
