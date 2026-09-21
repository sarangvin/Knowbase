import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { getSubscriptionStatus, startSubscribe, cancelSubscription, openCheckout, type SubscriptionStatus } from './billing'
import { User, LogOut, Cloud, Pencil, Trash, RotateCw, Archive } from '../../ui/icons'
import { fetchArchivedCollections, setCollectionArchived, deleteCollection } from '../automated-graph/collectionsApi'
import { SyncModal } from '../sync/SyncModal'
import './settings.css'

/** `onClose` omitted renders the panel inline as a full pane (the Settings
 * tab) instead of a modal — same content, no overlay, no Close button. */
export function SettingsPanel({ onClose }: { onClose?: () => void }) {
  const user = useVault((s) => s.user)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)
  const reloadVault = useVault((s) => s.reload)


  const [syncOpen, setSyncOpen] = useState(false)
  const [sub, setSub] = useState<SubscriptionStatus | null>(null)
  const [subBusy, setSubBusy] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  // Fetched rather than read from the vault index: Settings is reachable
  // with the demo vault loaded, or none at all, and "what have I archived"
  // is a question about the account either way.
  const [archived, setArchived] = useState<string[] | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  // The name of the collection being acted on, so only its own row goes
  // busy rather than the whole list.
  const [archiveBusy, setArchiveBusy] = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = () => {
    if (!user) return
    getSubscriptionStatus()
      .then(setSub)
      .catch((e) => setSubError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(refresh, [user])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetchArchivedCollections()
      .then((list) => !cancelled && setArchived(list))
      .catch(() => !cancelled && setArchived([]))
    return () => {
      cancelled = true
    }
  }, [user])

  const actOnArchived = async (space: string, fn: () => Promise<unknown>) => {
    setArchiveBusy(space)
    setArchiveError(null)
    try {
      await fn()
      setArchived((list) => (list ?? []).filter((s) => s !== space))
      // The vault in memory still holds the old flag, or the deleted notes,
      // and the home screen reads it from there — without this the change
      // does not show up until something else happens to reload.
      await reloadVault()
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : String(e))
    } finally {
      setArchiveBusy(null)
    }
  }

  const unarchive = (space: string) => void actOnArchived(space, () => setCollectionArchived(space, false))

  const deleteArchived = (space: string) => {
    // Same wall as the home screen's menu. Being archived makes a
    // collection easier to forget, not less real.
    const ok = confirm(
      `Delete "${space}" and all of its notes?\n\n` +
        `This cannot be undone. Your progress on them goes too.\n\n` +
        `It can stay archived instead — nothing is lost while it is.`,
    )
    if (!ok) return
    void actOnArchived(space, () => deleteCollection(space))
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

        {user && (
          <div className="settings-section">
            <div className="settings-label">Archived collections</div>
            <p className="settings-dim">
              Set aside, not deleted. Every note is still here; they just stay off the home
              screen and out of quizzes and flashcards until you bring them back.
            </p>
            <button className="ask-btn settings-sync-btn" onClick={() => setArchiveOpen(true)}>
              <Archive width={14} height={14} /> Check archive
              {archived != null && archived.length > 0 && ` (${archived.length})`}
            </button>
          </div>
        )}

        <div className="settings-section">
          <div className="settings-label">AI</div>
          <p className="settings-dim">
            Answers and note drafts use a hosted model. Nothing to configure.
          </p>
          {/* Moved off the top bar: a tool you reach for occasionally, on a
              vault you have written in, does not earn a permanent icon on
              every screen. */}
          <button className="ask-btn settings-sync-btn" onClick={() => setSyncOpen(true)}>
            <RotateCw width={14} height={14} /> Sync notes with AI
          </button>
          <p className="settings-dim">
            Answers any unanswered <code>Q:</code> in a note's Questions section and folds
            anything under My Notes into the AI Notes above it.
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

  /** The archive, as a list you open rather than a list that is always
   *  there. Archiving is a thing you do rarely and undo rarely, so the
   *  collections you set aside should not take up room in Settings beside
   *  the things you change. */
  const archiveDialog = archiveOpen ? (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-title"
      onClick={() => archiveBusy == null && setArchiveOpen(false)}
    >
      <div className="confirm-box archive-box" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title" id="archive-title">Archived collections</div>
        {archived == null ? (
          <p className="confirm-body">Loading…</p>
        ) : archived.length === 0 ? (
          <p className="confirm-body">
            Nothing archived. Use the ⋮ menu on a collection to set it aside — it keeps every
            note and just stops appearing on the home screen, in quizzes and in flashcards.
          </p>
        ) : (
          <>
            <p className="confirm-body">
              Every note in these is still here. Bring one back and it returns to the home
              screen and starts feeding quizzes and flashcards again.
            </p>
            <ul className="archive-list">
              {archived.map((space) => (
                <li key={space}>
                  <span className="archive-name">
                    <Archive width={14} height={14} /> {space}
                  </span>
                  <span className="archive-actions">
                    <button
                      className="ask-btn"
                      disabled={archiveBusy != null}
                      onClick={() => unarchive(space)}
                    >
                      {archiveBusy === space ? 'Working…' : 'Unarchive'}
                    </button>
                    <button
                      className="danger-btn"
                      disabled={archiveBusy != null}
                      onClick={() => deleteArchived(space)}
                    >
                      <Trash width={13} height={13} /> Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {archiveError && <div className="ask-error">{archiveError}</div>}
        <div className="confirm-actions">
          <button className="ask-btn" autoFocus disabled={archiveBusy != null} onClick={() => setArchiveOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  ) : null

  const sync = syncOpen ? <SyncModal onClose={() => setSyncOpen(false)} /> : null

  if (!onClose) return <div className="settings-pane">{body}{confirmDialog}{archiveDialog}{sync}</div>
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
      {confirmDialog}
      {archiveDialog}
      {sync}
    </div>
  )
}
