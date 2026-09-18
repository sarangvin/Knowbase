import { useEffect, useState } from 'react'
import {
  fetchUsers,
  fetchSignins,
  fetchSpaces,
  setApproved,
  fetchUserDetail,
  fetchCurrentUser,
  type AdminUserRow,
  type AdminSigninRow,
  type AdminSpaceRow,
  type AdminUserDetail,
} from './api'
import './admin.css'

type Tab = 'users' | 'signins' | 'spaces'

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

/** Access is a three-state read too: approved / asked and waiting / signed in
 * but never asked. "Waiting" is the one that needs the owner's attention, so
 * it's the only one that gets a colour. */
function AccessCell({ row }: { row: AdminSigninRow }) {
  // The stored column is false for owners — resolveSession grants them access
  // at request time rather than persisting it, so the raw row would render
  // "No access" for the one account that always has it.
  if (row.role === 'owner') return <span className="admin-pill admin-pill-yes">Always</span>
  if (row.access_approved) {
    return (
      <span className="admin-pill admin-pill-yes" title={row.access_approved_at ? `Approved ${new Date(row.access_approved_at).toLocaleString()}` : undefined}>
        Approved
      </span>
    )
  }
  if (row.access_requested_at) {
    return (
      <span className="admin-pill admin-pill-pending" title={`Requested ${new Date(row.access_requested_at).toLocaleString()}`}>
        Requested
      </span>
    )
  }
  return <span className="admin-pill admin-pill-unknown">No access</span>
}

export function AdminApp() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'ok'>('checking')
  const [tab, setTab] = useState<Tab>('users')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [signins, setSignins] = useState<AdminSigninRow[]>([])
  const [counts, setCounts] = useState({ verified: 0, unverified: 0, unknown: 0, approved: 0, pending: 0 })
  // Ids with an approve/revoke request in flight — disables just that row's
  // button rather than blocking the whole table.
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [spaces, setSpaces] = useState<AdminSpaceRow[]>([])
  const [library, setLibrary] = useState({ spaces: 0, notes: 0 })
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
        : tab === 'spaces'
        ? fetchSpaces().then((data) => {
            setSpaces(data.rows)
            setLibrary(data.library)
            setTotal(data.rows.length)
          })
        : fetchSignins(page).then((data) => {
            setSignins(data.signins)
            setTotal(data.total)
            setCounts({
              verified: data.verified,
              unverified: data.unverified,
              unknown: data.unknown,
              approved: data.approved,
              pending: data.pending,
            })
          })
    request
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [authState, page, tab])

  const toggleApproval = async (row: AdminSigninRow) => {
    if (row.access_approved && !confirm(
      `Revoke access for ${row.email}?\n\nThey'll keep their cloud vault data, but won't be able to open it until you approve them again.`,
    )) return

    setBusy((b) => new Set(b).add(row.id))
    setError(null)
    try {
      const next = await setApproved(row.id, !row.access_approved)
      // Patch in place rather than refetching the page: a refetch reorders by
      // last_login_at and the row you just clicked can jump away under the cursor.
      setSignins((rows) =>
        rows.map((r) =>
          r.id === row.id
            ? { ...r, access_approved: next.access_approved, access_approved_at: next.access_approved_at }
            : r,
        ),
      )
      setCounts((c) => ({
        ...c,
        approved: c.approved + (next.access_approved ? 1 : -1),
        pending: row.access_requested_at ? c.pending + (next.access_approved ? -1 : 1) : c.pending,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(row.id)
        return n
      })
    }
  }

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
        <button
          role="tab"
          aria-selected={tab === 'spaces'}
          className={`admin-tab${tab === 'spaces' ? ' admin-tab-active' : ''}`}
          onClick={() => setTab('spaces')}
        >
          Vault concepts
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {tab === 'spaces' ? (
        <>
          <p className="admin-dim">
            One row per space in a user's vault. A user with none has signed up but never
            generated anything. Reuse corpus: <strong>{library.spaces}</strong> space
            {library.spaces === 1 ? '' : 's'}, <strong>{library.notes}</strong> notes.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Live vault</th>
                <th>Notes</th>
                <th>Vault created</th>
                <th>First seen</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((r, i) => (
                <tr key={`${r.user_id}:${r.space ?? i}`} onClick={() => openDetail(r.user_id)} className="admin-row">
                  <td>
                    {r.email}
                    {r.role === 'owner' && <span className="admin-badge">owner</span>}
                    {!r.access_approved && r.role !== 'owner' && (
                      <div className="admin-subtle">not approved</div>
                    )}
                  </td>
                  <td>
                    {r.space ? (
                      r.space
                    ) : (
                      <span className="admin-pill admin-pill-unknown">no vault yet</span>
                    )}
                  </td>
                  <td>{r.space ? r.note_count : '—'}</td>
                  <td>{formatDate(r.vault_created)}</td>
                  <td title="Oldest surviving note timestamp — notes have no creation date, so editing every note moves this forward.">
                    {formatDate(r.first_seen)}
                  </td>
                  <td>{formatDate(r.last_updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && spaces.length === 0 && <p className="admin-dim">No users yet.</p>}
        </>
      ) : tab === 'signins' ? (
        <>
          <p className="admin-dim">
            {total} account{total === 1 ? '' : 's'} have signed in ·{' '}
            <strong>{counts.verified}</strong> verified
            {counts.unverified > 0 && <> · <strong>{counts.unverified}</strong> not verified</>}
            {counts.unknown > 0 && <> · <strong>{counts.unknown}</strong> unknown</>}
          </p>
          <p className="admin-dim">
            <strong>{counts.approved}</strong> with access
            {counts.pending > 0 && (
              <> · <strong className="admin-pending-count">{counts.pending}</strong> waiting on you</>
            )}
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Email verified</th>
                <th>Access</th>
                <th></th>
                <th>Sign-ins</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {signins.map((u) => (
                <tr key={u.id} onClick={() => openDetail(u.id)} className="admin-row">
                  <td>
                    {u.email}
                    {u.role === 'owner' && <span className="admin-badge">owner</span>}
                    {u.display_name && <div className="admin-subtle">{u.display_name}</div>}
                  </td>
                  <td><VerifiedCell value={u.email_verified} /></td>
                  <td><AccessCell row={u} /></td>
                  <td>
                    {u.role === 'owner' ? (
                      <span className="admin-subtle">always</span>
                    ) : (
                      <button
                        className={`admin-btn admin-btn-sm${u.access_approved ? '' : ' admin-btn-primary'}`}
                        disabled={busy.has(u.id)}
                        /* The row opens a detail overlay; without this the
                           click would do both. */
                        onClick={(e) => { e.stopPropagation(); void toggleApproval(u) }}
                      >
                        {busy.has(u.id) ? '…' : u.access_approved ? 'Revoke' : 'Verify'}
                      </button>
                    )}
                  </td>
                  <td>{u.login_count}</td>
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

      {/* /spaces returns every row at once — it is one row per space, not per
          note, so it stays small. Showing a pager there would imply pages
          that do not exist. */}
      {tab !== 'spaces' && (
        <div className="admin-pager">
          <button className="admin-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span className="admin-dim">Page {page} / {pageCount}</span>
          <button className="admin-btn" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

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
