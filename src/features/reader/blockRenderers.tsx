// Pluggable registry for special fenced code blocks (```dataviewjs, ```tasks…).
// The reader looks up a renderer by language; features (e.g. automated-graph)
// register real renderers at startup. Default shows the code in a labeled box.
import type { ReactNode } from 'react'

export interface BlockRendererProps {
  /** raw source inside the fence */
  source: string
  /** the note path the block lives in (for context-dependent queries) */
  notePath: string
  /** fenced language tag, e.g. "dataviewjs" */
  lang: string
}

export type BlockRenderer = (props: BlockRendererProps) => ReactNode

const registry = new Map<string, BlockRenderer>()

export function registerBlockRenderer(lang: string, renderer: BlockRenderer) {
  registry.set(lang.toLowerCase(), renderer)
}

export function getBlockRenderer(lang: string): BlockRenderer | undefined {
  return registry.get(lang.toLowerCase())
}
