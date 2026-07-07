import { useMemo, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import type { TreeNode } from '../../vault/types'
import { ChevronRight, FileText, Hash, Plus } from '../../ui/icons'
import { NewNoteModal } from './NewNoteModal'
import './explorer.css'

function collectFolderPaths(node: TreeNode, acc: Set<string>) {
  if (node.type === 'folder') {
    if (node.path) acc.add(node.path)
    node.children?.forEach((c) => collectFolderPaths(c, acc))
  }
}

function TreeItem({
  node,
  depth,
  expanded,
  toggle,
  activePath,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  toggle: (p: string) => void
  activePath: string | null
}) {
  const openNote = useVault((s) => s.openNote)
  const pad = 8 + depth * 14

  if (node.type === 'folder') {
    const isOpen = expanded.has(node.path)
    return (
      <div>
        <div className="tree-row folder" style={{ paddingLeft: pad }} onClick={() => toggle(node.path)}>
          <ChevronRight className={`tree-chevron ${isOpen ? 'open' : ''}`} />
          <span className="tree-label">{node.name}</span>
        </div>
        {isOpen &&
          node.children?.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              activePath={activePath}
            />
          ))}
      </div>
    )
  }

  if (node.type === 'asset') return null // assets are shown via embeds, not the tree

  const label = node.name.replace(/\.md$/i, '')
  return (
    <div
      className={`tree-row file ${activePath === node.path ? 'active' : ''}`}
      style={{ paddingLeft: pad + 4 }}
      onClick={() => openNote(node.path)}
      title={label}
    >
      {label.startsWith('_') ? <Hash className="tree-fileicon" /> : <FileText className="tree-fileicon" />}
      <span className="tree-label">{label}</span>
    </div>
  )
}

export function FileExplorer() {
  const tree = useVault((s) => s.tree)
  const view = useVault((s) => s.activeView())
  const activePath = view?.kind === 'note' ? view.path : null
  const [creating, setCreating] = useState(false)

  // Expand top two levels by default for an inviting first view.
  const allFolders = useMemo(() => {
    const s = new Set<string>()
    if (tree) collectFolderPaths(tree, s)
    return s
  }, [tree])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>()
    allFolders.forEach((p) => {
      if (p.split('/').length <= 2) s.add(p)
    })
    return s
  })

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })

  if (!tree) return null
  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <span className="panel-header" style={{ padding: '0 4px', flex: 1 }}>
          Files
        </span>
        <button className="icon-btn" title="New note" onClick={() => setCreating(true)}>
          <Plus />
        </button>
        <button className="icon-btn" title="Expand all" onClick={() => setExpanded(new Set(allFolders))}>
          <ChevronRight className="tree-chevron open" />
        </button>
      </div>
      {creating && <NewNoteModal onClose={() => setCreating(false)} />}
      <div className="tree-scroll">
        {tree.children?.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            activePath={activePath}
          />
        ))}
      </div>
    </div>
  )
}
