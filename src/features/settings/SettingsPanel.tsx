import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { listSavedKeys, saveKey, deleteKey, type SavedKey } from '../ask-ai/keys'
import { getSubscriptionStatus, startSubscribe, cancelSubscription, openCheckout, type SubscriptionStatus } from './billing'
import { User, LogOut, Cloud, Pencil } from '../../ui/icons'
import './settings.css'

/** `onClose` omitted renders the panel inline as a full pane (the Settings
 * tab) instead of a modal — same content, no overlay, no Close button. */
export function SettingsPanel({ onClose }: { onClose?: () => void }) {
  const user = useVault((s) => s.user)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)

  const [keys, setKeys] = useState<SavedKey[]>([])
  const [loading, setLoading] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sub, setSub] = useState<SubscriptionStatus | null>(null)
  const [subBusy, setSubBusy] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    listSavedKeys()
      .then(setKeys)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
    getSubscriptionStatus()
      .then(setSub)
      .catch((e) => setSubError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(refresh, [user])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const anthropicKey = keys.find((k) => k.provider === 'anthropic')

  const save = async () => {
    if (!apiKeyInput.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await saveKey('anthropic', apiKeyInput.trim())
      setApiKeyInput('')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteKey('anthropic')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const upgrade = async () => {
    if (subBusy) return
    setSubBusy(true)
    setSubError(null)
    try {
      const { subscriptionId, keyId } = await startSubscribe()
      await openCheckout({
        subscriptionId,
        keyId,
        onSuccess: () => {
          // Payment succeeded, but plan_tier flips only once the Razorpay
          // webhook lands — poll briefly rather than claiming Pro is active yet.
          setActivating(true)
          let tries = 0
          pollRef.current = setInterval(() => {
            tries++
            getSubscriptionStatus().then((s) => {
              setSub(s)
              if (s.planTier === 'pro' || tries >= 10) {
                setActivating(false)
                if (pollRef.current) clearInterval(pollRef.current)
              }
            })
          }, 2000)
        },
      })
    } catch (e) {
      setSubError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubBusy(false)
    }
  }

  const cancel = async () => {
    if (subBusy) return
    setSubBusy(true)
    setSubError(null)
    try {
      await cancelSubscription()
      refresh()
    } catch (e) {
      setSubError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubBusy(false)
    }
  }

  const body = (
    <>
        <div className="settings-title">Settings</div>

        {/* Account first: it answers "who am I signed in as" before any
            question about plans or keys, and it is where someone looks for
            sign-out. It used to be a popover on the status bar, which put a
            rarely-needed menu permanently in the chrome. */}
        <div className="settings-section">
          <div className="settings-label">Account</div>
          {user ? (
            <>
              <div className="settings-account">
                {user.avatarUrl ? (
                  <img className="settings-avatar" src={user.avatarUrl} alt="" />
                ) : (
                  <span className="settings-avatar settings-avatar-fallback"><User width={15} height={15} /></span>
                )}
                <div className="settings-account-who">
                  <div className="settings-account-name">{user.displayName || user.email}</div>
                  <div className="settings-dim" style={{ margin: 0 }}>
                    {user.displayName ? user.email : null}
                    {user.role === 'owner' ? (user.displayName ? ' · owner' : 'owner') : null}
                    {!user.accessApproved && ' · early access pending'}
                  </div>
                </div>
              </div>
              <div className="settings-account-actions">
                {user.accessApproved && (
                  <button className="ask-btn" onClick={() => void loadRemote()}>
                    <Cloud width={13} height={13} /> Open my cloud vault
                  </button>
                )}
                {user.role === 'owner' && (
                  <>
                    <button className="ask-btn" onClick={() => void loadGlobalVault()}>
                      <Pencil width={13} height={13} /> Edit the global vault
                    </button>
                    <a className="ask-btn" href="/admin"><User width={13} height={13} /> Admin</a>
                  </>
                )}
                <button className="ask-btn" onClick={() => void logout()}>
                  <LogOut width={13} height={13} /> Sign out
                </button>
              </div>
              {!user.accessApproved && (
                <p className="settings-dim">
                  Your cloud vault unlocks once your early access request is approved.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="settings-dim">
                Not signed in. Signing in saves your vault to your account and syncs it across devices.
              </p>
              <button className="ask-btn primary" onClick={loginWithGoogle}>
                <User width={13} height={13} /> Create account or sign in
              </button>
            </>
          )}
        </div>

        {user && (
          <div className="settings-section">
            <div className="settings-label">Plan</div>
            {activating ? (
              <p className="settings-dim">Payment received — activating your Pro plan…</p>
            ) : sub?.planTier === 'pro' ? (
              <div className="settings-key-row">
                <span className="settings-key-label">Pro — {sub.status}</span>
                <button className="ask-btn" disabled={subBusy} onClick={() => void cancel()}>Cancel subscription</button>
              </div>
            ) : (
              <div className="settings-key-row">
                <span className="settings-key-label">Free plan</span>
                <button className="ask-btn primary" disabled={subBusy} onClick={() => void upgrade()}>
                  Upgrade to Pro
                </button>
              </div>
            )}
            {subError && <div className="ask-error">{subError}</div>}
          </div>
        )}

        <div className="settings-section">
          <div className="settings-label">AI providers</div>
          <p className="settings-dim">
            Free tier (a hosted Gemma model) works with no setup. Add your own Anthropic key below
            to use Claude instead, or use a local Ollama server — no account needed for that.
          </p>

          {!user ? (
            <div className="settings-note">
              <button className="ask-btn" onClick={loginWithGoogle}>Sign in with Google to add a key</button>
            </div>
          ) : loading ? (
            <div className="settings-note">Loading…</div>
          ) : (
            <div className="settings-key-row">
              <span className="settings-key-label">Anthropic (Claude)</span>
              {anthropicKey ? (
                <>
                  <code className="settings-key-value">sk-…{anthropicKey.lastFour}</code>
                  <button className="ask-btn" disabled={busy} onClick={() => void remove()}>Remove</button>
                </>
              ) : (
                <>
                  <input
                    className="settings-key-input"
                    type="password"
                    placeholder="sk-ant-…"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void save()}
                  />
                  <button className="ask-btn primary" disabled={busy || !apiKeyInput.trim()} onClick={() => void save()}>
                    Save
                  </button>
                </>
              )}
            </div>
          )}
          {error && <div className="ask-error">{error}</div>}
        </div>

        {onClose && (
          <div className="settings-foot">
            <button className="ask-btn" onClick={onClose}>Close</button>
          </div>
        )}
    </>
  )

  if (!onClose) return <div className="settings-pane">{body}</div>
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  )
}
