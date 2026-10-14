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

/** Paths per /notes/read request. The server takes up to 500. */
const READ_CHUNK = 200

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

  async list(opts?: { background?: boolean }): Promise<VaultFileMeta[]> {
    // A background listing is the periodic sync checking for notes the
    // server has written. It is the same query, but it is not somebody
    // opening their vault, and logging it as one would bury the real
    // figure under a row a minute per open tab.
    const q = opts?.background ? '?background=1' : ''
    return api<VaultFileMeta[]>(`${this.base}/notes${q}`)
  }

  async readText(path: string): Promise<string> {
    const { content } = await api<{ content: string }>(`${this.base}/note?path=${encodeURIComponent(path)}`)
    return content
  }

  /** One POST per READ_CHUNK paths, one at a time, instead of a GET per note
   *  all at once. A burst of parallel GETs against a cold function had
   *  Vercel boot an instance for each of them. The server may hand some
   *  back in `deferred` when a reply would be too large; those go round
   *  again. */
  async readMany(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const queue = [...paths]
    while (queue.length > 0) {
      const chunk = queue.splice(0, READ_CHUNK)
      const { notes, deferred } = await api<{ notes: { path: string; content: string }[]; deferred: string[] }>(
        `${this.base}/notes/read`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: chunk }) },
      )
      for (const n of notes) out.set(n.path, n.content)
      queue.unshift(...deferred)
    }
    return out
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
  /** Owner approval for cloud features. Owners are always true. */
  accessApproved: boolean
  /** When they asked for access; null if they never have. */
  accessRequestedAt: string | null
}

export async function fetchCurrentUser(): Promise<RemoteUser | null> {
  const { user } = await api<{ user: RemoteUser | null }>('/auth/me')
  return user
}

/** Ask the owner for early access. Idempotent server-side — the first
 * request's timestamp is the one kept. */
export async function requestAccess(topic?: string): Promise<string | null> {
  const res = await fetch('/auth/request-access', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: topic ?? '' }),
  })
  if (!res.ok) throw new Error(`Could not send the request: ${res.status}`)
  const data = (await res.json()) as { accessRequestedAt: string | null }
  return data.accessRequestedAt
}

// The reuse corpus (library lookup, adopting a space, contributing drafts)
// used to be driven from here, by the client, during onboarding. It is now
// entirely server-side — see backend/src/onboarding/run.ts, which checks the
// corpus before it spends model calls and contributes what it generated
// afterwards. The HTTP routes still exist under /api/vaults/library/* and
// /api/vaults/mine/adopt; nothing in this app calls them any more.

export function signInWithGoogle(returnTo = '/'): void {
  window.location.href = `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
}

export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
}
