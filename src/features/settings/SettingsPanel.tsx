import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { listSavedKeys, saveKey, deleteKey, type SavedKey } from '../ask-ai/keys'
import { getSubscriptionStatus, startSubscribe, cancelSubscription, openCheckout, type SubscriptionStatus } from './billing'
import './settings.css'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const user = useVault((s) => s.user)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-title">Settings</div>

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

        <div className="settings-foot">
          <button className="ask-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
