// "Find sources": fills a note's Useful Links with pages whose own text backs
// up what the note says. The work is server-side (backend/src/notes/sources.ts);
// this is the button and what it says while it waits.
//
// Who sees what:
//   Free and new  — the button, and pressing it explains it is Pro. Seeing the
//                   feature where it would help is the point; hiding it from
//                   free readers hid the reason to upgrade.
//   Pro           — finds a note's sources once. No rerun.
//   Max (and the owner) — can check again, once per note per day. This is
//                   where search grounding goes when it is live, which costs
//                   real money per use.
// The server enforces all of it (routes/notes.ts); this only decides what
// to draw.
//
// Shown only on the reader's own cloud vault — it writes into the note, and
// the demo and the library are not theirs to write.
import { useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { RemoteVaultSource } from '../../vault/remoteSource'
import type { Note } from '../../vault/types'
import { PAYMENTS_ENABLED, atLeastPro } from '../settings/plans'

/** The day the note's sources were last checked, from the block's marker
 *  (written by backend/src/notes/sources.ts). Null if it has none. */
function checkedOn(raw: string): string | null {
  return raw.match(/<!-- rabbithole:sources v1 checked (\d{4}-\d{2}-\d{2}) -->/)?.[1] ?? null
}

export function FindSources({ note }: { note: Note }) {
  const user = useVault((s) => s.user)
  const source = useVault((s) => s.source)
  const refreshVault = useVault((s) => s.refreshVault)
  const openView = useVault((s) => s.openView)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [upsell, setUpsell] = useState(false)

  const own = source instanceof RemoteVaultSource && source.mode === 'personal'
  if (!user || !own) return null

  const checked = checkedOn(note.raw)
  const hasSources = checked != null
  // The same UTC day the server compares against.
  const checkedToday = checked === new Date().toISOString().slice(0, 10)

  const isMax = user.role === 'owner' || user.planTier === 'max'
  const isPro = isMax || atLeastPro(user.planTier)
  // Pro has found this note's sources already; checking again is Max.
  if (hasSources && !isMax) return null

  const run = async () => {
    if (busy) return
    if (!isPro) {
      setUpsell(true)
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/notes/sources', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path }),
      })
      const data = (await res.json().catch(() => ({}))) as { sources?: unknown[]; error?: string; upgrade?: string }
      if (res.status === 403 && data.upgrade === 'pro') {
        setUpsell(true)
        return
      }
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

  if (upsell) {
    return (
      <div className="find-sources-upsell" role="status">
        <div className="find-sources-upsell-title">Finding sources is part of Pro</div>
        <p>
          Pro finds pages that back up this note — each link shown with the exact sentence on the
          page that supports it — so you can check what you are learning.
        </p>
        <div className="find-sources-upsell-actions">
          {PAYMENTS_ENABLED ? (
            <button className="ask-btn primary" onClick={() => openView({ kind: 'settings' })}>
              Upgrade to Pro
            </button>
          ) : (
            <button className="ask-btn primary" disabled>
              Pro is coming soon
            </button>
          )}
          <button className="ask-btn" onClick={() => setUpsell(false)}>
            Not now
          </button>
        </div>
      </div>
    )
  }

  if (hasSources && checkedToday && !busy) {
    return (
      <div className="find-sources">
        <button className="ask-btn" disabled>
          Checked today
        </button>
        <span className="find-sources-hint">You can check these sources again tomorrow.</span>
      </div>
    )
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
