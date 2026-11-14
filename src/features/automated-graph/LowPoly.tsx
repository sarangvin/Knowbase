// A low-poly backdrop for a collection's logo tile, drawn in code.
//
// Points are scattered from a seed (the collection name), triangulated with
// delaunator, and each facet is shaded from the accent orange: lighter
// towards a light source in the top-left, with a little per-facet noise so
// it reads as cut stone rather than a gradient. The same name always gives
// the same pattern, and every collection a different one. No image files,
// no model, nothing to store.
//
// Trianglify does this too, but it is GPL-3 (and pulls a native canvas
// package); delaunator is what it is built on, and is ISC.
import { useMemo } from 'react'
import Delaunator from 'delaunator'

/** Small, fast, seeded PRNG (mulberry32) from a string hash. */
function rngFor(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SIZE = 100
const CELLS = 3

export function LowPoly({ seed }: { seed: string }) {
  const facets = useMemo(() => {
    const rand = rngFor(seed)
    const step = SIZE / CELLS
    const pts: number[] = []
    // A jittered grid, with the border points kept on the edge so the
    // facets fill the tile with no gaps at the corners.
    for (let y = 0; y <= CELLS; y++) {
      for (let x = 0; x <= CELLS; x++) {
        const edgeX = x === 0 || x === CELLS
        const edgeY = y === 0 || y === CELLS
        pts.push(
          x * step + (edgeX ? 0 : (rand() - 0.5) * step * 0.9),
          y * step + (edgeY ? 0 : (rand() - 0.5) * step * 0.9),
        )
      }
    }
    // Each collection leans its orange a little warmer or cooler.
    const hueShift = (rand() - 0.5) * 14
    const { triangles } = new Delaunator(pts)
    const out: { d: string; fill: string }[] = []
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]]
      const xs = [pts[2 * a], pts[2 * b], pts[2 * c]]
      const ys = [pts[2 * a + 1], pts[2 * b + 1], pts[2 * c + 1]]
      const cx = (xs[0] + xs[1] + xs[2]) / 3
      const cy = (ys[0] + ys[1] + ys[2]) / 3
      // Light from the top-left: 0 there, 1 in the far corner.
      const shade = (cx + cy) / (2 * SIZE)
      const light = 70 - shade * 26 + (rand() - 0.5) * 14
      const fill = `hsl(${24 + hueShift} ${86 + (rand() - 0.5) * 8}% ${light.toFixed(1)}%)`
      out.push({ d: `M${xs[0]} ${ys[0]}L${xs[1]} ${ys[1]}L${xs[2]} ${ys[2]}Z`, fill })
    }
    return out
  }, [seed])

  return (
    <svg className="lowpoly" viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="none" aria-hidden="true">
      {facets.map((f, i) => (
        // The stroke in the facet's own colour closes the hairline seams
        // anti-aliasing leaves between neighbouring triangles.
        <path key={i} d={f.d} fill={f.fill} stroke={f.fill} strokeWidth={0.6} strokeLinejoin="round" />
      ))}
    </svg>
  )
}
