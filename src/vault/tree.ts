import type { TreeNode, VaultFileMeta } from './types'

/** Build a nested folder tree from a flat file list, folders-first then A→Z. */
export function buildTree(files: VaultFileMeta[]): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'folder', children: [] }
  const dirCache = new Map<string, TreeNode>([['', root]])

  const ensureDir = (dirPath: string): TreeNode => {
    if (dirCache.has(dirPath)) return dirCache.get(dirPath)!
    const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : ''
    const parent = ensureDir(parentPath)
    const node: TreeNode = {
      name: dirPath.slice(dirPath.lastIndexOf('/') + 1),
      path: dirPath,
      type: 'folder',
      children: [],
    }
    parent.children!.push(node)
    dirCache.set(dirPath, node)
    return node
  }

  for (const f of files) {
    const slash = f.path.lastIndexOf('/')
    const dirPath = slash < 0 ? '' : f.path.slice(0, slash)
    const dir = ensureDir(dirPath)
    dir.children!.push({
      name: f.path.slice(slash + 1),
      path: f.path,
      type: f.type === 'note' ? 'note' : 'asset',
    })
  }

  const sortRec = (node: TreeNode) => {
    if (!node.children) return
    node.children.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1
      if (a.type !== 'folder' && b.type === 'folder') return 1
      return a.name.localeCompare(b.name)
    })
    node.children.forEach(sortRec)
  }
  sortRec(root)
  return root
}
