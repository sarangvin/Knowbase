import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { getSubscriptionStatus, startSubscribe, cancelSubscription, openCheckout, type SubscriptionStatus } from './billing'
import { User, LogOut, Cloud, Pencil, Trash } from '../../ui/icons'
import './settings.css'

/** `onClose` omitted renders the panel inline as a full pane (the Settings
 * tab) instead of a modal — same content, no overlay, no Close button. */
export function SettingsPanel({ onClose }: { onClose?: () => void }) {
  const user = useVault((s) => s.user)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)


  const [sub, setSub] = useState<SubscriptionStatus | null>(null)
  const [subBusy, setSubBusy] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = () => {
    if (!user) return
    getSubscriptionStatus()
      .then(setSub)
      .catch((e) => setSubError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(refresh, [user])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])


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

  const doReset = async () => {
    if (resetting) return
    setResetting(true)
    setResetError(null)
    try {
      const res = await fetch('/api/account/reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      if (!res.ok) throw new Error(`Could not reset the account (${res.status})`)
      setConfirmOpen(false)
      // Full reload rather than patching state: the vault, its index, open
      // tabs and the onboarding job have all just ceased to exist server-side,
      // and rebuilding that by hand is more ways to get it subtly wrong than
      // starting clean. Boot then finds an empty vault and offers onboarding.
      location.assign('/')
    } catch (e) {
      setResetError(e instanceof Error ? e.message : String(e))
      setResetting(false)
    }
  }

  const confirmDialog = confirmOpen ? (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-title"
      // Backdrop click cancels; it can only ever cancel, never confirm.
      onClick={() => !resetting && setConfirmOpen(false)}
    >
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title" id="reset-title">Erase your vault?</div>
        <p className="confirm-body">
          This <strong>cannot be undone</strong>. There is no backup and no way to recover
          these notes afterwards.
        </p>
        <ul className="confirm-list">
          <li>Every note in your cloud vault is deleted</li>
          <li>Your account, sign-in and access are kept</li>
          <li>Shared notes already in the library are not affected</li>
        </ul>
        <div className="confirm-actions">
          {/* Cancel first and focused: in a dialog whose other option is
              irreversible, the safe choice should be the easy one. */}
          <button className="ask-btn" autoFocus disabled={resetting} onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
          <button className="danger-btn" disabled={resetting} onClick={() => void doReset()}>
            {resetting ? 'Erasing…' : 'Yes, erase everything'}
          </button>
        </div>
      </div>
    </div>
  ) : null

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
          <div className="settings-label">AI</div>
          <p className="settings-dim">
            Answers and note drafts use a hosted model. Nothing to configure.
          </p>
        </div>

        {user && (
          <div className="settings-section settings-danger">
            <div className="settings-label">Reset account</div>
            <p className="settings-dim">
              Deletes every note in your cloud vault and lets you start again with a new
              topic. Your account, sign-in and access stay as they are.
            </p>
            <button className="danger-btn" disabled={resetting} onClick={() => setConfirmOpen(true)}>
              <Trash width={13} height={13} /> {resetting ? 'Erasing…' : 'Reset my account'}
            </button>
            {resetError && <div className="ask-error">{resetError}</div>}
          </div>
        )}

        {onClose && (
          <div className="settings-foot">
            <button className="ask-btn" onClick={onClose}>Close</button>
          </div>
        )}
    </>
  )

  if (!onClose) return <div className="settings-pane">{body}{confirmDialog}</div>
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
      {confirmDialog}
    </div>
  )
}
