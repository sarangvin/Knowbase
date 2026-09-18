import { useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { FsAccessVaultSource } from '../../vault/source'
import { requestAccess } from '../../vault/remoteSource'
import { GraduationCap, Folder, Eye, Cloud, Pencil, Envelope, Check } from '../../ui/icons'
import './onboarding.css'

/** Shown to a signed-in user the owner hasn't approved yet. The cloud vault
 * and every LLM route are gated server-side (requireApproved), so this is the
 * honest presentation of a real restriction, not a soft UI hint — offering an
 * "Open my cloud vault" button here would just produce a 403.
 *
 * The demo vault and "open my own folder" stay available: both are entirely
 * client-side and cost the owner nothing. */
function EarlyAccess({ requestedAt }: { requestedAt: string | null }) {
  const [sent, setSent] = useState<string | null>(requestedAt)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sent) {
    return (
      <div className="ob-pending">
        <Check /> Request received — we'll email you when your access is ready.
      </div>
    )
  }

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      setSent(await requestAccess())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button className="ob-btn" disabled={sending} onClick={() => void send()}>
        <Envelope /> {sending ? 'Sending…' : 'Sign up for early access'}
      </button>
      {error && <div className="ob-error">{error}</div>}
    </>
  )
}

export function Onboarding() {
  const status = useVault((s) => s.status)
  const error = useVault((s) => s.error)
  const loadSeed = useVault((s) => s.loadSeed)
  const pickFolder = useVault((s) => s.pickFolder)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const user = useVault((s) => s.user)
  const fsSupported = FsAccessVaultSource.isSupported()

  if (status === 'loading') {
    return (
      <div className="onboarding">
        <div className="spinner" />
        <p className="ob-sub">Indexing vault…</p>
      </div>
    )
  }

  const awaitingApproval = user != null && !user.accessApproved

  return (
    <div className="onboarding">
      <div className="ob-card">
        <div className="ob-logo">
          <GraduationCap width={34} height={34} />
        </div>
        <h1 className="ob-title">Rabbithole</h1>
        <p className="ob-sub">
          A local-first knowledge base. Browse the linked graph, follow backlinks, and learn what
          to study next — all in your browser.
        </p>

        {error && <div className="ob-error">{error}</div>}

        <div className="ob-actions">
          <button className="ob-btn primary" onClick={() => void loadSeed()}>
            <Eye /> Explore the demo vault
          </button>

          {user == null && (
            <button className="ob-btn" onClick={loginWithGoogle}>
              <Cloud /> Sign in with Google
            </button>
          )}
          {user != null && !awaitingApproval && (
            <button className="ob-btn" onClick={() => void loadRemote()}>
              <Cloud /> Open my cloud vault
            </button>
          )}
          {awaitingApproval && <EarlyAccess requestedAt={user.accessRequestedAt} />}

          {user?.role === 'owner' && (
            <button className="ob-btn" onClick={() => void loadGlobalVault()}>
              <Pencil /> Edit the global vault
            </button>
          )}
          {fsSupported ? (
            <button className="ob-btn" onClick={() => void pickFolder()}>
              <Folder /> Open my own folder
            </button>
          ) : (
            <div className="ob-note">
              Tip: open in Chrome or Edge to load your own folder with read/write access.
            </div>
          )}
        </div>
        {user && (
          <p className="ob-note">
            Signed in as {user.email} ·{' '}
            <button className="ob-linklike" onClick={() => void logout()}>
              sign out
            </button>
          </p>
        )}
        <p className="ob-fineprint">
          Demo edits save in this browser; your own folder writes to disk; your cloud vault syncs
          to your account and is only visible to you.
        </p>
      </div>
    </div>
  )
}
