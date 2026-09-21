// The Files tab: the graph by default, the folder tree as the alternative.
//
// The graph leads because it answers the question a vault of generated notes
// actually raises — how does this subject hang together — and because the
// tree is a poor first impression of a structure the reader did not build:
// two folders named after the machinery that made them, with everything of
// interest three levels down. The tree is still the right tool for "where is
// that note", so it is one tap away rather than gone.
//
// The choice is remembered per device. Somebody who prefers the list should
// not have to say so on every visit, and which pane you like to browse in is
// not a setting worth syncing.
import { useState } from 'react'
import { GraphView } from '../graph/GraphView'
import { FileExplorer } from './FileExplorer'
import { Network, List } from '../../ui/icons'
import './filespane.css'

type Mode = 'graph' | 'tree'

const MODE_KEY = 'kb:files-view'

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'tree' ? 'tree' : 'graph'
  } catch {
    // Blocked storage. The default is the honest fallback, not an error.
    return 'graph'
  }
}

export function FilesPane() {
  const [mode, setMode] = useState<Mode>(readMode)

  const choose = (next: Mode) => {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // The pane still switches; only the memory is lost.
    }
  }

  return (
    <div className="filespane">
      <div className="filespane-bar">
        <label className="filespane-select">
          <span className="filespane-icon" aria-hidden="true">
            {mode === 'graph' ? <Network /> : <List />}
          </span>
          {/* A real <select>: two options today, but this is the list of
              ways to look at a vault and it is the kind of list that grows.
              A native control also gives the phone its own picker for free. */}
          <select
            aria-label="How to show the vault"
            value={mode}
            onChange={(e) => choose(e.target.value as Mode)}
          >
            <option value="graph">Graph</option>
            <option value="tree">Folders</option>
          </select>
        </label>
      </div>

      {/* Both stay mounted and full size; the hidden one is hidden with
          `visibility`, not `display`.
          Unmounting the graph throws away a force simulation that took real
          work to settle, so coming back would re-randomise every node and
          land on a different layout than the one you left — the graph would
          stop being a place. `display: none` does the same thing by a
          different route: it reports a zero-size box, and GraphView drops
          its canvas below nonzero width. Visibility keeps the box. */}
      <div className="filespane-stack">
        <div className={'filespane-body' + (mode === 'graph' ? '' : ' is-hidden')}>
          <GraphView />
        </div>
        <div className={'filespane-body' + (mode === 'tree' ? '' : ' is-hidden')}>
          <div className="files-pane">
            <FileExplorer />
          </div>
        </div>
      </div>
    </div>
  )
}
