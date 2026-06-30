// Registers native renderers for the vault's ```dataviewjs dashboards. Dataview JS
// can't run in the browser, so we recompute its output from frontmatter (see engine.ts)
// and render real dashboards. Dispatch is by the note's path.
import { registerBlockRenderer, type BlockRendererProps } from '../reader/blockRenderers'
import { spaceOfPath } from './engine'
import { NextUp, Today, Flashcards } from './Dashboards'

function Dashboard({ notePath }: BlockRendererProps) {
  const file = notePath.split('/').pop() ?? ''
  if (/Next Up\.md$/i.test(file)) {
    const space = spaceOfPath(notePath)
    if (space) return <NextUp space={space} />
  }
  if (/Today\.md$/i.test(file)) return <Today />
  if (/Flashcards\.md$/i.test(file)) return <Flashcards />
  return (
    <div className="dv dv-generic">
      <span className="dv-faint">Computed dashboard (no native view for this block).</span>
    </div>
  )
}

export function registerAutomatedGraph() {
  registerBlockRenderer('dataviewjs', Dashboard)
  registerBlockRenderer('dataview', Dashboard)
}
