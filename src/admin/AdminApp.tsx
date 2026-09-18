import { useEffect, useState } from 'react'
import {
  fetchUsers,
  fetchSignins,
  fetchUserDetail,
  fetchCurrentUser,
  type AdminUserRow,
  type AdminSigninRow,
  type AdminUserDetail,
} from './api'
import './admin.css'

type Tab = 'users' | 'signins'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  return s ? new Date(s).toLocaleString() : '—'
}

/** Three-valued on purpose — see the /signins route comment. "Unknown" is a
 * real state (no verification claim observed yet), not a styling variant of
 * "no", and collapsing it would misreport accounts that simply predate the
 * column. */
function VerifiedCell({ value }: { value: boolean | null }) {
  if (value === true) return <span className="admin-pill admin-pill-yes">Verified</span>
  if (value === false) return <span className="admin-pill admin-pill-no">Not verified</span>
  return (
    <span className="admin-pill admin-pill-unknown" title="No verification claim recorded yet — this account has not signed in since the column was added.">
      Unknown
    </span>
  )
}

export function AdminApp() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'ok'>('checking')
  const [tab, setTab] = useState<Tab>('users')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [signins, setSignins] = useState<AdminSigninRow[]>([])
  const [counts, setCounts] = useState({ verified: 0, unverified: 0, unknown: 0 })
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUserDetail | null>(null)

  useEffect(() => {
    // Signed-out and signed-in-but-not-owner collapse into one 'denied' state
    // that renders as a plain not-found. Distinguishing them would confirm to
    // a stranger that an admin panel lives at this URL.
    fetchCurrentUser()
      .then((user) => {
        const owner = user?.role === 'owner'
        setAuthState(owner ? 'ok' : 'denied')
        // Only name the panel once we know who's looking. admin.html ships a
        // neutral <title> so the served HTML gives nothing away.
        if (owner) document.title = 'Rabbithole Admin'
      })
      .catch(() => setAuthState('denied'))
  }, [])

  // Reset paging when switching tabs — page 3 of Users is meaningless in Sign-ins.
  useEffect(() => { setPage(1) }, [tab])

  useEffect(() => {
    if (authState !== 'ok') return
    setLoading(true)
    setError(null)
    const request =
      tab === 'users'
        ? fetchUsers(page).then((data) => {
            setRows(data.users)
            setTotal(data.total)
          })
        : fetchSignins(page).then((data) => {
            setSignins(data.signins)
            setTotal(data.total)
            setCounts({ verified: data.verified, unverified: data.unverified, unknown: data.unknown })
          })
    request
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [authState, page, tab])

  const openDetail = (id: string) => {
    setSelected(null)
    fetchUserDetail(id)
      .then(setSelected)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  if (authState === 'checking') {
    return <div className="admin-shell" />
  }
  if (authState === 'denied') {
    // Deliberately says nothing about an admin panel, whether one exists here,
    // or who may use it. The API is already owner-gated (requireOwner 403s),
    // so this is presentation only — but a page that advertises itself is a
    // pointer for anyone poking at URLs. Owner signs in via the main app.
    return (
      <div className="admin-shell">
        <h1>404</h1>
        <p className="admin-dim">This page could not be found.</p>
        <a className="admin-btn" href="/">Go to Rabbithole</a>
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="admin-shell">
      <h1>Rabbithole Admin</h1>

      <div className="admin-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'users'}
          className={`admin-tab${tab === 'users' ? ' admin-tab-active' : ''}`}
          onClick={() => setTab('users')}
        >
          Users
        </button>
        <button
          role="tab"
          aria-selected={tab === 'signins'}
          className={`admin-tab${tab === 'signins' ? ' admin-tab-active' : ''}`}
          onClick={() => setTab('signins')}
        >
          Sign-ins
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {tab === 'signins' ? (
        <>
          <p className="admin-dim">
            {total} account{total === 1 ? '' : 's'} have signed in ·{' '}
            <strong>{counts.verified}</strong> verified
            {counts.unverified > 0 && <> · <strong>{counts.unverified}</strong> not verified</>}
            {counts.unknown > 0 && <> · <strong>{counts.unknown}</strong> unknown</>}
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Verified</th>
                <th>Name</th>
                <th>Sign-ins</th>
                <th>First seen</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {signins.map((u) => (
                <tr key={u.id} onClick={() => openDetail(u.id)} className="admin-row">
                  <td>{u.email}{u.role === 'owner' && <span className="admin-badge">owner</span>}</td>
                  <td><VerifiedCell value={u.email_verified} /></td>
                  <td>{u.display_name ?? '—'}</td>
                  <td>{u.login_count}</td>
                  <td>{formatDate(u.created_at)}</td>
                  <td>{formatDate(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && signins.length === 0 && <p className="admin-dim">No sign-ins recorded yet.</p>}
        </>
      ) : (
      <>
      <p className="admin-dim">{total} user{total === 1 ? '' : 's'}</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Plan</th>
            <th>Notes</th>
            <th>Storage</th>
            <th>LLM calls (month)</th>
            <th>Joined</th>
            <th>Last login</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} onClick={() => openDetail(u.id)} className="admin-row">
              <td>{u.email}{u.role === 'owner' && <span className="admin-badge">owner</span>}</td>
              <td>{u.plan_tier}</td>
              <td>{u.note_count}</td>
              <td>{formatBytes(u.storage_bytes)}</td>
              <td>{u.llm_calls_this_month}</td>
              <td>{formatDate(u.created_at)}</td>
              <td>{formatDate(u.last_login_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </>
      )}
      {loading && <p className="admin-dim">Loading…</p>}

      <div className="admin-pager">
        <button className="admin-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span className="admin-dim">Page {page} / {pageCount}</span>
        <button className="admin-btn" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>

      {selected && (
        <div className="admin-overlay" onClick={() => setSelected(null)}>
          <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
            <div className="admin-panel-head">
              <strong>{selected.user.email}</strong>
              <button className="admin-btn" onClick={() => setSelected(null)}>Close</button>
            </div>
            <p className="admin-dim">
              Role: {selected.user.role} · Plan: {selected.user.planTier}
              {selected.subscription && ` (${selected.subscription.status})`}
            </p>
            <p className="admin-dim">Joined {formatDate(selected.user.createdAt)} · Last login {formatDate(selected.user.lastLoginAt)}</p>
            <div className="admin-label">Recent activity</div>
            {selected.recentEvents.length === 0 ? (
              <p className="admin-dim">No activity yet.</p>
            ) : (
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr><th>Event</th><th>Provider</th><th>Model</th><th>Tokens</th><th>Latency</th><th>When</th></tr>
                </thead>
                <tbody>
                  {selected.recentEvents.map((e) => (
                    <tr key={e.id}>
                      <td>{e.event_type}</td>
                      <td>{e.provider ?? '—'}</td>
                      <td>{e.model ?? '—'}</td>
                      <td>{e.input_tokens != null ? `${e.input_tokens}→${e.output_tokens ?? '?'}` : '—'}</td>
                      <td>{e.latency_ms != null ? `${e.latency_ms}ms` : '—'}</td>
                      <td>{formatDate(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
