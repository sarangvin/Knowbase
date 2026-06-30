// ─────────────────────────────────────────────────────────────────────────────
// VaultSource: abstracts WHERE a vault's bytes come from, so the rest of the app
// is storage-agnostic. Two implementations:
//   • SeedVaultSource    — the bundled demo vault under /vault (read-only, fetch)
//   • FsAccessVaultSource — the user's own folder via File System Access API (r/w)
// ─────────────────────────────────────────────────────────────────────────────
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, createStore } from 'idb-keyval'
import type { VaultFileMeta } from './types'

export interface VaultSource {
  readonly kind: 'seed' | 'fs'
  readonly name: string
  /** Whether writes are supported (saving edits back to disk / local overlay). */
  readonly writable: boolean
  list(): Promise<VaultFileMeta[]>
  readText(path: string): Promise<string>
  /** Returns an object URL for an asset (image/pdf). Caller may revoke it. */
  assetUrl(path: string): Promise<string>
  writeText?(path: string, text: string): Promise<void>
}

// Browser-local overlay so the static demo vault is still editable: edits and
// new notes are persisted in IndexedDB, layered over the bundled read-only files.
const overlayStore = createStore('knowbase-overlay', 'notes')
const OVERLAY_PREFIX = 'note:'
const overlay = {
  get: (path: string) => idbGet<string>(OVERLAY_PREFIX + path, overlayStore),
  set: (path: string, text: string) => idbSet(OVERLAY_PREFIX + path, text, overlayStore),
  paths: async () =>
    (await idbKeys(overlayStore))
      .map((k) => String(k))
      .filter((k) => k.startsWith(OVERLAY_PREFIX))
      .map((k) => k.slice(OVERLAY_PREFIX.length)),
}

const MD_EXT = new Set(['md'])
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'base'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

function encodePath(p: string): string {
  // Static dev/CDN servers resolve files with decodeURI (NOT decodeURIComponent),
  // which leaves reserved chars like `&` encoded. So we must mirror encodeURI:
  // encode spaces but keep `&` literal, then also escape the few chars encodeURI
  // leaves alone that would break a path (`#`, `?`).
  return encodeURI(p).replace(/[#?]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

// ── Seed (bundled demo) ──────────────────────────────────────────────────────
export class SeedVaultSource implements VaultSource {
  readonly kind = 'seed' as const
  readonly writable = true
  name = 'KnowBase (demo)'

  async list(): Promise<VaultFileMeta[]> {
    const res = await fetch(`${import.meta.env.BASE_URL}vault/manifest.json`)
    if (!res.ok) throw new Error('Could not load bundled vault manifest')
    const data = (await res.json()) as { name?: string; files: VaultFileMeta[] }
    if (data.name) this.name = `${data.name} (demo)`
    // Merge in any notes the user created locally (overlay-only paths).
    const known = new Set(data.files.map((f) => f.path))
    const extra: VaultFileMeta[] = (await overlay.paths())
      .filter((p) => !known.has(p) && p.toLowerCase().endsWith('.md'))
      .map((p) => ({ path: p, type: 'note', ext: 'md', size: 0, mtime: Date.now() }))
    return [...data.files, ...extra]
  }

  async readText(path: string): Promise<string> {
    // Locally-saved version (overlay) wins over the bundled original.
    const local = await overlay.get(path)
    if (local != null) return local
    const res = await fetch(`${import.meta.env.BASE_URL}vault/${encodePath(path)}`)
    if (!res.ok) throw new Error(`Could not read ${path}`)
    return res.text()
  }

  async writeText(path: string, text: string): Promise<void> {
    await overlay.set(path, text)
  }

  async assetUrl(path: string): Promise<string> {
    return `${import.meta.env.BASE_URL}vault/${encodePath(path)}`
  }
}

// ── File System Access API (user's own folder, read/write) ───────────────────
const HANDLE_KEY = 'knowbase:dirHandle'

export class FsAccessVaultSource implements VaultSource {
  readonly kind = 'fs' as const
  readonly writable = true
  name: string
  private root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
    this.name = root.name
  }

  static isSupported(): boolean {
    return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  }

  /** Prompt the user to pick a folder; persists the handle for next time. */
  static async pick(): Promise<FsAccessVaultSource> {
    const picker = (window as unknown as {
      showDirectoryPicker: (o?: unknown) => Promise<FileSystemDirectoryHandle>
    }).showDirectoryPicker
    const handle = await picker({ mode: 'readwrite' })
    await idbSet(HANDLE_KEY, handle)
    return new FsAccessVaultSource(handle)
  }

  /** Try to restore a previously-picked folder (re-verifies permission). */
  static async restore(): Promise<FsAccessVaultSource | null> {
    const handle = (await idbGet(HANDLE_KEY)) as FileSystemDirectoryHandle | undefined
    if (!handle) return null
    const q = (handle as unknown as {
      queryPermission?: (o: unknown) => Promise<PermissionState>
    }).queryPermission
    if (q) {
      const state = await q.call(handle, { mode: 'readwrite' })
      if (state !== 'granted') return null
    }
    return new FsAccessVaultSource(handle)
  }

  static async forget(): Promise<void> {
    await idbDel(HANDLE_KEY)
  }

  private async resolveHandle(path: string, create = false) {
    const parts = path.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let dir = this.root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create })
    }
    return { dir, fileName }
  }

  async list(): Promise<VaultFileMeta[]> {
    const out: VaultFileMeta[] = []
    const ignore = new Set(['.obsidian', '.git', '.trash'])
    const walk = async (dir: FileSystemDirectoryHandle, base: string) => {
      for await (const [entryName, entry] of dir.entries()) {
        if (ignore.has(entryName) || entryName.startsWith('.')) continue
        const rel = base ? `${base}/${entryName}` : entryName
        if (entry.kind === 'directory') {
          await walk(entry as FileSystemDirectoryHandle, rel)
        } else {
          const ext = extOf(entryName)
          if (!MD_EXT.has(ext) && !ASSET_EXT.has(ext)) continue
          let size = 0
          let mtime = 0
          try {
            const file = await (entry as FileSystemFileHandle).getFile()
            size = file.size
            mtime = file.lastModified
          } catch {
            /* ignore */
          }
          out.push({ path: rel, type: MD_EXT.has(ext) ? 'note' : 'asset', ext, size, mtime })
        }
      }
    }
    await walk(this.root, '')
    return out
  }

  async readText(path: string): Promise<string> {
    const { dir, fileName } = await this.resolveHandle(path)
    const fh = await dir.getFileHandle(fileName)
    const file = await fh.getFile()
    return file.text()
  }

  async assetUrl(path: string): Promise<string> {
    const { dir, fileName } = await this.resolveHandle(path)
    const fh = await dir.getFileHandle(fileName)
    const file = await fh.getFile()
    return URL.createObjectURL(file)
  }

  async writeText(path: string, text: string): Promise<void> {
    const { dir, fileName } = await this.resolveHandle(path, true)
    const fh = await dir.getFileHandle(fileName, { create: true })
    const writable = await (fh as unknown as {
      createWritable: () => Promise<FileSystemWritableFileStream>
    }).createWritable()
    await writable.write(text)
    await writable.close()
  }
}
