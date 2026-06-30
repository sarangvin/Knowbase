// ─────────────────────────────────────────────────────────────────────────────
// The central app store (Zustand). This is the public API every feature panel
// uses. Holds the loaded vault index, tabs/navigation, UI panel state, and the
// search index. Keep action signatures stable — features depend on them.
// ─────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand'
import MiniSearch from 'minisearch'
import type { Note, TreeNode, VaultFileMeta, VaultIndex } from './types'
import type { VaultSource } from './source'
import { SeedVaultSource, FsAccessVaultSource } from './source'
import { parseNote } from './parse'
import { buildIndex, resolveTarget } from './graph'
import { buildTree } from './tree'

export type View =
  | { kind: 'note'; path: string; heading?: string }
  | { kind: 'graph' }
  | { kind: 'home' }

export interface Tab {
  id: string
  history: View[]
  pos: number
}

export type RightPanel = 'backlinks' | 'outline' | 'tags'
export type Mode = 'read' | 'edit'

export interface SearchHit {
  path: string
  title: string
  name: string
  score: number
  snippet: string
}

interface VaultState {
  // ── lifecycle ──
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  source: VaultSource | null
  sourceName: string
  writable: boolean

  // ── data ──
  index: VaultIndex | null
  files: VaultFileMeta[]
  tree: TreeNode | null

  // ── navigation ──
  tabs: Tab[]
  activeTabId: string | null
  mode: Mode

  // ── ui ──
  leftOpen: boolean
  rightOpen: boolean
  rightPanel: RightPanel
  paletteOpen: boolean
  quickSwitchOpen: boolean
  searchOpen: boolean

  // ── actions: loading ──
  loadSeed: () => Promise<void>
  pickFolder: () => Promise<void>
  tryRestoreFolder: () => Promise<boolean>
  reload: () => Promise<void>

  // ── actions: navigation ──
  openNote: (path: string, opts?: { newTab?: boolean; replace?: boolean; heading?: string }) => void
  openView: (view: View, opts?: { newTab?: boolean; replace?: boolean }) => void
  back: () => void
  forward: () => void
  newTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setMode: (mode: Mode) => void

  // ── actions: editing ──
  saveNote: (path: string, text: string) => Promise<void>
  createNote: (path: string, content?: string) => Promise<void>

  // ── actions: ui ──
  toggleLeft: () => void
  toggleRight: () => void
  setRightPanel: (p: RightPanel) => void
  setPaletteOpen: (open: boolean) => void
  setQuickSwitchOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void

  // ── selectors / helpers ──
  activeView: () => View | null
  activeNote: () => Note | null
  getNote: (path: string) => Note | undefined
  resolveLink: (target: string) => string | null
  searchNotes: (query: string) => SearchHit[]
  canBack: () => boolean
  canForward: () => boolean
}

let _searchIndex: MiniSearch | null = null
let _tabSeq = 0
const newTabId = () => `tab-${++_tabSeq}`

function buildSearch(notes: Note[]): MiniSearch {
  const mini = new MiniSearch({
    fields: ['title', 'name', 'body', 'tags'],
    storeFields: ['title', 'name', 'path'],
    idField: 'path',
    searchOptions: { boost: { title: 3, name: 2 }, prefix: true, fuzzy: 0.2 },
  })
  mini.addAll(
    notes.map((n) => ({
      path: n.path,
      title: n.title,
      name: n.name,
      body: n.body,
      tags: n.tags.join(' '),
    })),
  )
  return mini
}

function snippetFor(note: Note, query: string): string {
  const text = note.body.replace(/[#*`>_\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  let idx = -1
  for (const t of terms) {
    idx = text.toLowerCase().indexOf(t)
    if (idx >= 0) break
  }
  if (idx < 0) return text.slice(0, 120)
  const start = Math.max(0, idx - 40)
  return (start > 0 ? '…' : '') + text.slice(start, start + 160).trim() + '…'
}

export const useVault = create<VaultState>((set, get) => {
  async function loadFromSource(source: VaultSource) {
    set({ status: 'loading', error: null, source, sourceName: source.name, writable: source.writable })
    try {
      const files = await source.list()
      const noteMetas = files.filter((f) => f.type === 'note')
      const parsed: Note[] = await Promise.all(
        noteMetas.map(async (m) => parseNote(m.path, await source.readText(m.path), m.mtime)),
      )
      const index = buildIndex(parsed)
      _searchIndex = buildSearch(parsed)
      const tree = buildTree(files)

      // Pick a sensible landing note: Welcome > Today > first note.
      const preferred =
        parsed.find((n) => /(^|\/)Welcome\.md$/i.test(n.path)) ??
        parsed.find((n) => /(^|\/)Today\.md$/i.test(n.path)) ??
        parsed[0]
      const firstView: View = preferred ? { kind: 'note', path: preferred.path } : { kind: 'home' }
      const tab: Tab = { id: newTabId(), history: [firstView], pos: 0 }

      set({
        status: 'ready',
        index,
        files,
        tree,
        sourceName: source.name,
        tabs: [tab],
        activeTabId: tab.id,
      })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const mutateActiveTab = (fn: (tab: Tab) => Tab) => {
    const { tabs, activeTabId } = get()
    set({ tabs: tabs.map((t) => (t.id === activeTabId ? fn(t) : t)) })
  }

  const pushView = (view: View, opts?: { newTab?: boolean; replace?: boolean }) => {
    if (opts?.newTab) {
      const tab: Tab = { id: newTabId(), history: [view], pos: 0 }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      return
    }
    mutateActiveTab((tab) => {
      if (opts?.replace && tab.history.length) {
        const history = [...tab.history]
        history[tab.pos] = view
        return { ...tab, history }
      }
      const history = tab.history.slice(0, tab.pos + 1)
      history.push(view)
      return { ...tab, history, pos: history.length - 1 }
    })
  }

  return {
    status: 'idle',
    error: null,
    source: null,
    sourceName: '',
    writable: false,
    index: null,
    files: [],
    tree: null,
    tabs: [],
    activeTabId: null,
    mode: 'read',
    leftOpen: true,
    rightOpen: true,
    rightPanel: 'backlinks',
    paletteOpen: false,
    quickSwitchOpen: false,
    searchOpen: false,

    loadSeed: async () => loadFromSource(new SeedVaultSource()),
    pickFolder: async () => {
      try {
        const source = await FsAccessVaultSource.pick()
        await loadFromSource(source)
      } catch (e) {
        // user cancelled picker -> ignore; real errors surface
        if (e instanceof DOMException && e.name === 'AbortError') return
        set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      }
    },
    tryRestoreFolder: async () => {
      try {
        const source = await FsAccessVaultSource.restore()
        if (!source) return false
        await loadFromSource(source)
        return true
      } catch {
        return false
      }
    },
    reload: async () => {
      const src = get().source
      if (src) await loadFromSource(src)
    },

    openNote: (path, opts) =>
      pushView({ kind: 'note', path, heading: opts?.heading }, opts),
    openView: (view, opts) => pushView(view, opts),
    back: () =>
      mutateActiveTab((tab) => (tab.pos > 0 ? { ...tab, pos: tab.pos - 1 } : tab)),
    forward: () =>
      mutateActiveTab((tab) =>
        tab.pos < tab.history.length - 1 ? { ...tab, pos: tab.pos + 1 } : tab,
      ),
    newTab: () => {
      const tab: Tab = { id: newTabId(), history: [{ kind: 'home' }], pos: 0 }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    },
    closeTab: (id) => {
      const { tabs, activeTabId } = get()
      if (tabs.length <= 1) return
      const idx = tabs.findIndex((t) => t.id === id)
      const next = tabs.filter((t) => t.id !== id)
      let active = activeTabId
      if (activeTabId === id) active = next[Math.max(0, idx - 1)]?.id ?? next[0].id
      set({ tabs: next, activeTabId: active })
    },
    setActiveTab: (id) => set({ activeTabId: id }),
    setMode: (mode) => set({ mode }),

    saveNote: async (path, text) => {
      const { source, index } = get()
      if (!source?.writable || !source.writeText) throw new Error('This vault is read-only')
      await source.writeText(path, text)
      if (!index) return
      // Re-parse just this note and rebuild the index (vault is small).
      const note = parseNote(path, text, Date.now())
      const all = [...index.notes.values()].filter((n) => n.path !== path)
      all.push(note)
      const rebuilt = buildIndex(all)
      _searchIndex = buildSearch(all)
      set({ index: rebuilt })
    },
    createNote: async (path, content = '') => {
      const { source } = get()
      if (!source?.writable || !source.writeText) throw new Error('This vault is read-only')
      const full = path.endsWith('.md') ? path : `${path}.md`
      await source.writeText(full, content)
      await get().reload()
      get().openNote(full)
    },

    toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
    toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
    setRightPanel: (p) => set({ rightPanel: p, rightOpen: true }),
    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setQuickSwitchOpen: (open) => set({ quickSwitchOpen: open }),
    setSearchOpen: (open) => set({ searchOpen: open, rightOpen: open ? true : get().rightOpen }),

    activeView: () => {
      const { tabs, activeTabId } = get()
      const tab = tabs.find((t) => t.id === activeTabId)
      return tab ? tab.history[tab.pos] ?? null : null
    },
    activeNote: () => {
      const v = get().activeView()
      if (v?.kind !== 'note') return null
      return get().index?.notes.get(v.path) ?? null
    },
    getNote: (path) => get().index?.notes.get(path),
    resolveLink: (target) => {
      const { index } = get()
      if (!index) return null
      return resolveTarget(target, index.notes, index.nameToPath)
    },
    searchNotes: (query) => {
      if (!_searchIndex || !query.trim()) return []
      const { index } = get()
      return _searchIndex
        .search(query)
        .slice(0, 50)
        .map((r) => {
          const note = index?.notes.get(r.id as string)
          return {
            path: r.id as string,
            title: (r as unknown as { title: string }).title,
            name: (r as unknown as { name: string }).name,
            score: r.score,
            snippet: note ? snippetFor(note, query) : '',
          }
        })
    },
    canBack: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      return !!t && t.pos > 0
    },
    canForward: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      return !!t && t.pos < t.history.length - 1
    },
  }
})
