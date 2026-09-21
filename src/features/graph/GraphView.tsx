import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { useVault } from '../../vault/vaultStore'
import { buildGraphData } from '../../vault/graph'
import './graph.css'

interface GNode {
  id: string
  label: string
  resolved: boolean
  degree: number
  x?: number
  y?: number
}
interface GLink {
  source: string | GNode
  target: string | GNode
}

/** Below this zoom, only the hovered and focused nodes are named.
 *
 *  Labels come in as you zoom, the way Obsidian's graph does. There used to
 *  be an escape hatch — always label a graph under 45 nodes — which was
 *  fine while this was a desktop-only pane. It is the Files tab's default
 *  view now, and on a phone zoomToFit leaves every label at full size on a
 *  tight cluster: a wall of overlapping text.
 *
 *  0.5 rather than the old 0.85 because 0.85 hid them everywhere once the
 *  escape hatch went. Measured, on the demo vault's 22 notes, the zoom the
 *  initial fit settles at: 0.75 at 1024px, 0.65 at 768px, 0.24 at 375px.
 *  So a desktop or tablet opens with its labels and a phone opens on the
 *  shape, a pinch away from the names. */
const LABEL_ZOOM = 0.5

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function GraphView({ focusPath, compact }: { focusPath?: string; compact?: boolean }) {
  const index = useVault((s) => s.index)
  const openNote = useVault((s) => s.openNote)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<string | null>(null)

  // Fresh data each render (the lib mutates link source/target into node refs).
  const data = useMemo(() => {
    if (!index) return { nodes: [] as GNode[], links: [] as GLink[] }
    const g = buildGraphData(index, focusPath, compact ? 1 : undefined)
    return {
      nodes: g.nodes.map((n) => ({ id: n.id, label: n.label, resolved: n.resolved, degree: n.degree })),
      links: g.links.map((l) => ({ source: l.source, target: l.target })),
    }
  }, [index, focusPath, compact])

  // Adjacency for hover highlighting.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of data.links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      if (!m.has(s)) m.set(s, new Set())
      if (!m.has(t)) m.set(t, new Set())
      m.get(s)!.add(t)
      m.get(t)!.add(s)
    }
    return m
  }, [data])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Configure physics + frame once per actual DATA change (guarded by ref, not
  // just the dependency array — size.w starts at 0 and ForceGraph2D doesn't
  // mount until it's nonzero, so on first mount this effect must still fire once
  // fg becomes available even though `data`/`compact` haven't changed since the
  // no-op run at size.w===0). A container resize (sidebar toggle, window resize)
  // must NOT go through this path: restarting the simulation re-seeds every node
  // at a new random position and can re-converge to a worse (clumped) layout
  // than the one already on screen. Resizing only needs a re-frame — see below.
  const configuredForRef = useRef<typeof data | null>(null)
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || size.w === 0 || configuredForRef.current === data) return
    configuredForRef.current = data
    // Spread nodes out so labels don't overlap. Scale repulsion with node count —
    // a fixed charge leaves larger graphs (20+ nodes) clumped in the center.
    const charge = fg.d3Force('charge')
    if (charge) charge.strength(-(compact ? 70 : 140) - data.nodes.length * (compact ? 0.6 : 1.2))
    const link = fg.d3Force('link')
    if (link) link.distance(compact ? 30 : 55)
    // warmupTicks (below) runs the layout to completion synchronously before the
    // first paint, so a short delay is enough to let the canvas render once
    // before framing it (duration=0: no animated zoom needed).
    const t = setTimeout(() => fg.zoomToFit(0, compact ? 24 : 70), 150)
    return () => clearTimeout(t)
  }, [data, compact, size.w])

  // On resize, just re-frame the EXISTING (already-settled) layout — never restart
  // the physics. size.w is checked so this doesn't fire before the graph exists.
  useEffect(() => {
    if (size.w === 0) return
    const t = setTimeout(() => fgRef.current?.zoomToFit(200, compact ? 24 : 70), 50)
    return () => clearTimeout(t)
  }, [size.w, size.h, compact])

  const accent = cssVar('--accent') || '#f28136'
  const faint = cssVar('--text-faint') || '#7a6f66'
  const muted = cssVar('--text-muted') || '#ada097'
  const bg = cssVar('--bg-primary') || '#1c1917'

  if (!index) return null

  return (
    <div className={`graph-wrap ${compact ? 'compact' : ''}`} ref={wrapRef}>
      {size.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor={bg}
          // Run the layout to completion before the first paint (no visible
          // clump-then-freeze), then allow a modest amount of live settling
          // for drag interactivity. cooldownTicks alone (no warmup) permanently
          // stops the simulation ~2s after mount regardless of whether nodes
          // have actually finished spreading — on larger graphs (20+ notes)
          // that froze them mid-clump forever, since no more ticks ever run.
          warmupTicks={Math.min(120, 40 + data.nodes.length * 3)}
          cooldownTicks={90}
          d3VelocityDecay={0.45}
          nodeRelSize={compact ? 3 : 4}
          linkColor={(l) => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GNode).id
            const t = typeof l.target === 'string' ? l.target : (l.target as GNode).id
            if (hover && (s === hover || t === hover)) return accent
            return 'hsl(26 20% 70% / 0.1)'
          }}
          linkWidth={(l) => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GNode).id
            const t = typeof l.target === 'string' ? l.target : (l.target as GNode).id
            return hover && (s === hover || t === hover) ? 1.5 : 1
          }}
          onNodeHover={(n) => setHover(n ? (n as GNode).id : null)}
          onNodeClick={(n) => openNote((n as GNode).id)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GNode
            const isFocus = n.id === focusPath
            const r = (isFocus ? 5 : 2.4) + Math.sqrt(n.degree) * (compact ? 1.0 : 1.4)
            const dim = hover && hover !== n.id && !neighbors.get(hover)?.has(n.id)
            ctx.globalAlpha = dim ? 0.18 : 1
            ctx.beginPath()
            ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI)
            ctx.fillStyle = !n.resolved ? faint : isFocus ? '#fff5ec' : accent
            ctx.fill()
            if (isFocus) {
              ctx.lineWidth = 1.5
              ctx.strokeStyle = accent
              ctx.stroke()
            }
            // Labels come in as you zoom, the way Obsidian's graph does.
            //
            // There used to be an escape hatch — always label a graph under
            // 45 nodes — which was fine while this was a desktop-only pane.
            // It is the Files tab's default view now, and on a 375px screen
            // zoomToFit leaves every label at full size on a tight cluster:
            // a wall of overlapping text. Zoom is the honest signal for "is
            // there room to read this", and it already works.
            const showLabel = n.id === hover || isFocus || globalScale > LABEL_ZOOM
            if (showLabel && !dim) {
              // Constant on-screen label size (the canvas ctx is pre-scaled by zoom).
              const fs = (compact ? 9 : 11) / globalScale
              ctx.font = `${fs}px Inter, sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              ctx.fillStyle = n.id === hover ? muted : faint
              ctx.fillText(n.label, n.x!, n.y! + r + 2 / globalScale)
            }
            ctx.globalAlpha = 1
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as GNode
            const r = (n.id === focusPath ? 6 : 4) + Math.sqrt(n.degree) * 1.4
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(n.x!, n.y!, r + 2, 0, 2 * Math.PI)
            ctx.fill()
          }}
        />
      )}
      {data.nodes.length === 0 && <div className="empty-state">No linked notes here.</div>}
    </div>
  )
}
