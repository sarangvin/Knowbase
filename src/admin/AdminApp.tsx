import { useEffect, useState } from 'react'
import { fetchUsers, fetchUserDetail, fetchCurrentUser, type AdminUserRow, type AdminUserDetail } from './api'
import './admin.css'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  return s ? new Date(s).toLocaleString() : '—'
}

export function AdminApp() {
  const [authState, setAuthState] = useState<'checking' | 'signed-out' | 'not-owner' | 'ok'>('checking')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUserDetail | null>(null)

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user) setAuthState('signed-out')
      else if (user.role !== 'owner') setAuthState('not-owner')
      else setAuthState('ok')
    })
  }, [])

  useEffect(() => {
    if (authState !== 'ok') return
    setLoading(true)
    fetchUsers(page)
      .then((data) => {
        setRows(data.users)
        setTotal(data.total)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [authState, page])

  const openDetail = (id: string) => {
    setSelected(null)
    fetchUserDetail(id)
      .then(setSelected)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  if (authState === 'checking') {
    return <div className="admin-shell"><p>Loading…</p></div>
  }
  if (authState === 'signed-out' || authState === 'not-owner') {
    return (
      <div className="admin-shell">
        <h1>KnowBase Admin</h1>
        <p className="admin-dim">
          {authState === 'signed-out' ? 'Sign in with the owner Google account to view this.' : "You're signed in, but not as the owner account."}
        </p>
        <a className="admin-btn" href="/auth/google/start?returnTo=/admin.html">Sign in with Google</a>
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="admin-shell">
      <h1>KnowBase Admin</h1>
      <p className="admin-dim">{total} user{total === 1 ? '' : 's'}</p>
      {error && <div className="admin-error">{error}</div>}

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
