// Cloud-backed VaultSource, served by knowbase-backend. Two modes sharing one
// class since they differ only in which base route they hit:
//   • 'personal' (default) — /api/vaults/mine/* — the signed-in user's own
//     vault, merged with a read-only overlay of the global vault (entries
//     carry `origin: 'personal' | 'global'`; writing always lands in the
//     user's personal vault, shadowing any global note at the same path —
//     the same "local overlay wins" rule SeedVaultSource already uses).
//   • 'global' — /api/vaults/global/* — owner-only editing of the raw global
//     vault itself; the backend 403s any non-owner that hits these routes.
import type { VaultFileMeta } from './types'
import type { VaultSource } from './source'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export type RemoteVaultMode = 'personal' | 'global'

export class RemoteVaultSource implements VaultSource {
  readonly kind = 'remote' as const
  readonly writable = true
  readonly mode: RemoteVaultMode
  name: string
  private readonly base: string

  constructor(mode: RemoteVaultMode = 'personal') {
    this.mode = mode
    this.base = mode === 'global' ? '/api/vaults/global' : '/api/vaults/mine'
    this.name = mode === 'global' ? 'Global Vault (owner edit)' : 'My Vault (cloud)'
  }

  async list(): Promise<VaultFileMeta[]> {
    return api<VaultFileMeta[]>(`${this.base}/notes`)
  }

  async readText(path: string): Promise<string> {
    const { content } = await api<{ content: string }>(`${this.base}/note?path=${encodeURIComponent(path)}`)
    return content
  }

  async writeText(path: string, text: string): Promise<void> {
    const res = await fetch(`${this.base}/note?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    })
    if (!res.ok) throw new Error(`Could not save ${path}: ${res.status}`)
  }

  async assetUrl(path: string): Promise<string> {
    return `${this.base}/asset?path=${encodeURIComponent(path)}`
  }

  isPathWritable(_path: string): boolean {
    // Always true in both modes: writing a personal-mode path always succeeds
    // by shadowing (see file header); global mode is inherently owner-only.
    return true
  }
}

export interface RemoteUser {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  planTier: string
}

export async function fetchCurrentUser(): Promise<RemoteUser | null> {
  const { user } = await api<{ user: RemoteUser | null }>('/auth/me')
  return user
}

export function signInWithGoogle(returnTo = '/'): void {
  window.location.href = `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
}

export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
}
