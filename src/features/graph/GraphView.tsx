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

  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    // Spread nodes out so labels don't overlap. Scale repulsion with node count —
    // a fixed charge leaves larger graphs (20+ nodes) clumped in the center.
    const charge = fg.d3Force('charge')
    if (charge) charge.strength(-(compact ? 70 : 140) - data.nodes.length * (compact ? 0.6 : 1.2))
    const link = fg.d3Force('link')
    if (link) link.distance(compact ? 30 : 55)
    fg.d3ReheatSimulation?.()
    // A single delayed zoomToFit, with duration=0 (instant, no animation). An
    // animated zoom races the still-settling simulation — nodes keep drifting
    // during the pan/zoom tween, so the final frame no longer matches their
    // positions. Snapping instantly after the layout has had time to settle
    // avoids that race entirely.
    const t = setTimeout(() => fg.zoomToFit(0, compact ? 24 : 70), 2200)
    return () => clearTimeout(t)
  }, [data, size.w, compact])

  const accent = cssVar('--accent') || '#9b7ed6'
  const faint = cssVar('--text-faint') || '#666'
  const muted = cssVar('--text-muted') || '#999'
  const bg = cssVar('--bg-primary') || '#1e1e1e'

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
          cooldownTicks={120}
          d3VelocityDecay={0.45}
          nodeRelSize={compact ? 3 : 4}
          linkColor={(l) => {
            const s = typeof l.source === 'string' ? l.source : (l.source as GNode).id
            const t = typeof l.target === 'string' ? l.target : (l.target as GNode).id
            if (hover && (s === hover || t === hover)) return accent
            return 'rgba(255,255,255,0.08)'
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
            ctx.fillStyle = !n.resolved ? faint : isFocus ? '#fff' : accent
            ctx.fill()
            if (isFocus) {
              ctx.lineWidth = 1.5
              ctx.strokeStyle = accent
              ctx.stroke()
            }
            const showLabel =
              n.id === hover || isFocus || globalScale > 0.85 || (!compact && data.nodes.length < 45)
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
