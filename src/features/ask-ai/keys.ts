// Client for /api/settings/keys — the backend never returns ciphertext or
// plaintext, only metadata (provider + last four chars) for display.
export interface SavedKey {
  provider: string
  lastFour: string
  updatedAt: string
}

export async function listSavedKeys(): Promise<SavedKey[]> {
  const res = await fetch('/api/settings/keys', { credentials: 'include' })
  if (!res.ok) throw new Error(`Could not load saved keys: ${res.status}`)
  return res.json()
}

export async function saveKey(provider: string, apiKey: string): Promise<void> {
  const res = await fetch('/api/settings/keys', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `Could not save key: ${res.status}`)
  }
}

export async function deleteKey(provider: string): Promise<void> {
  const res = await fetch(`/api/settings/keys/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Could not delete key: ${res.status}`)
}
