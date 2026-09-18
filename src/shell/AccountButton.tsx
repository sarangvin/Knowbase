// Bottom-left account control, sitting at the head of the status bar.
//
// It also closes a real funnel gap: until now the only sign-in entry points
// were the landing screen and a line buried in Settings under "add a key".
// Someone exploring the demo who decided they wanted their own vault had to
// find their way back out to the landing page. Now the invitation is present
// on every screen, at the edge of vision rather than in the way.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../vault/vaultStore'
import { User, LogOut, Cloud, Pencil } from '../ui/icons'

export function AccountButton() {
  const user = useVault((s) => s.user)
  const authChecked = useVault((s) => s.authChecked)
  const loginWithGoogle = useVault((s) => s.loginWithGoogle)
  const logout = useVault((s) => s.logout)
  const loadRemote = useVault((s) => s.loadRemote)
  const loadGlobalVault = useVault((s) => s.loadGlobalVault)

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click and on Escape. Both, not just one: a popover
  // that only closes by clicking its own trigger is a trap for keyboard users.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Render nothing until the session check resolves. Flashing "Create
  // account" at someone who is already signed in, for the length of one
  // fetch, reads as having been logged out.
  if (!authChecked) return null

  if (!user) {
    return (
      <button
        className="acct-btn"
        onClick={loginWithGoogle}
        title="Sign in with Google — creates your account if you don't have one yet"
      >
        <User width={13} height={13} /> Create account
      </button>
    )
  }

  const pending = !user.accessApproved
  const label = user.displayName || user.email

  return (
    <div className="acct-wrap" ref={wrapRef}>
      <button
        className="acct-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.email}
      >
        {user.avatarUrl ? (
          <img className="acct-avatar" src={user.avatarUrl} alt="" />
        ) : (
          <User width={13} height={13} />
        )}
        <span className="acct-label">{label}</span>
        {pending && <span className="acct-pill">pending</span>}
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-menu-head">{user.email}</div>
          {pending ? (
            <div className="acct-menu-note">
              Early access pending — we'll let you know when your vault is ready.
            </div>
          ) : (
            <button
              className="acct-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void loadRemote()
              }}
            >
              <Cloud width={13} height={13} /> Open my cloud vault
            </button>
          )}
          {user.role === 'owner' && (
            <>
              <button
                className="acct-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  void loadGlobalVault()
                }}
              >
                <Pencil width={13} height={13} /> Edit the global vault
              </button>
              <a className="acct-menu-item" role="menuitem" href="/admin">
                <User width={13} height={13} /> Admin
              </a>
            </>
          )}
          <button
            className="acct-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void logout()
            }}
          >
            <LogOut width={13} height={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
