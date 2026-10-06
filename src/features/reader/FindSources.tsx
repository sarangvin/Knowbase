// "Find sources": fills a note's Useful Links with pages whose own text backs
// up what the note says. The work is server-side (backend/src/notes/sources.ts);
// this is the button and what it says while it waits.
//
// Pro, and the owner. Shown only on the reader's own cloud vault — it writes
// into the note, and the demo and the library are not theirs to write.
import { useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { RemoteVaultSource } from '../../vault/remoteSource'
import type { Note } from '../../vault/types'

export function FindSources({ note, hasSources }: { note: Note; hasSources: boolean }) {
  const user = useVault((s) => s.user)
  const source = useVault((s) => s.source)
  const refreshVault = useVault((s) => s.refreshVault)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const allowed = user != null && (user.role === 'owner' || user.planTier === 'pro')
  const own = source instanceof RemoteVaultSource && source.mode === 'personal'
  if (!allowed || !own) return null

  const run = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/notes/sources', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path }),
      })
      const data = (await res.json().catch(() => ({}))) as { sources?: unknown[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Could not find sources (${res.status})`)
      const n = data.sources?.length ?? 0
      if (n === 0) {
        setMessage('No page found that clearly backs this note up. Nothing was changed.')
      } else {
        // The server wrote the note; pull it in so the links appear here.
        await refreshVault()
        setMessage(null)
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="find-sources">
      <button className="ask-btn" onClick={() => void run()} disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" /> Checking sources…
          </>
        ) : hasSources ? (
          'Check sources again'
        ) : (
          'Find sources'
        )}
      </button>
      {!busy && !message && !hasSources && (
        <span className="find-sources-hint">Links whose own text backs up this note, each with the sentence that does.</span>
      )}
      {message && <span className="find-sources-hint">{message}</span>}
    </div>
  )
}
