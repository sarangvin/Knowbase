import { useEffect, useState } from 'react'
import {
  fetchUsers,
  fetchSignins,
  fetchSpaces,
  fetchUsage,
  fetchQueue,
  drainQueueNow,
  retryFailedJobs,
  setApproved,
  setPlan,
  fetchUserDetail,
  fetchCurrentUser,
  type AdminUserRow,
  type AdminSigninRow,
  type AdminSpaceRow,
  type AdminUsageResponse,
  type AdminQueueResponse,
  type AdminQueueRow,
  type AdminUserDetail,
} from './api'
import './admin.css'

type Tab = 'users' | 'signins' | 'spaces' | 'usage' | 'queue'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(s: string | null): string {
  return s ? new Date(s).toLocaleString() : '—'
}

/** "4m ago" rather than a timestamp. The queue is read to answer how long
 *  something has been stuck, and an absolute time makes the reader do the
 *  subtraction. */
function ago(s: string | null): string {
  if (!s) return '—'
  const secs = Math.max(0, (Date.now() - new Date(s).getTime()) / 1000)
  if (secs < 60) return `${Math.round(secs)}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

/** A 'running' row that started more than the in-flight window ago is not
 *  running — its invocation was killed and nothing has reclaimed it yet. The
 *  backend computes that distinction; showing them the same would hide the
 *  one case that needs a human. */
function QueueStatus({ row }: { row: AdminQueueRow }) {
  if (row.status === 'running') {
    return row.in_flight
      ? <span className="admin-pill admin-pill-pending">Drafting</span>
      : <span className="admin-pill admin-pill-no" title="Claimed, then the invocation died. Reclaimed after 5 minutes.">Stalled</span>
  }
  if (row.status === 'pending') return <span className="admin-pill admin-pill-unknown">Waiting</span>
  if (row.status === 'failed') return <span className="admin-pill admin-pill-no">Given up</span>
  return <span className="admin-pill admin-pill-yes">Done</span>
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

/** used / limit with a bar. Colours only at the point action is needed:
 *  a quota at 30% is not information, a quota at 90% is. */
function Meter({ used, limit }: { used: number; limit?: number }) {
  if (limit == null) return <span className="admin-subtle">{used.toLocaleString()}</span>
  const pct = Math.min(100, (used / limit) * 100)
  const level = pct >= 90 ? ' meter-danger' : pct >= 70 ? ' meter-warn' : ''
  return (
    <div className={`usage-meter${level}`}>
      <div className="usage-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <span className="usage-num">
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
    </div>
  )
}

/** What the drafting worker is doing right now.
 *
 *  There is no long-running worker to look at — drafts are drained by
 *  whichever request happens to poll — so this table is the only place the
 *  work is visible while it exists. It answers, in order: is anything moving,
 *  whose note is it, and if it is not moving, why. */
function QueuePanel({
  data, loading, busy, onDrain, onRetry,
}: {
  data: AdminQueueResponse | null
  loading: boolean
  busy: boolean
  onDrain: () => void
  onRetry: () => void
}) {
  const depth = data?.depth
  const rows = data?.rows ?? []
  const timing = data?.timing

  return (
    <>
      <p className="admin-dim">
        Notes queued for drafting (<code>draft_queue</code>). One job runs at a
        time — the concurrency guard is also what keeps us inside the model's
        15 requests a minute. Work is drained by the app's status poll, so with
        nobody signed in the queue sits still; "Process one now" is the nudge.
      </p>

      <div className="admin-queue-head">
        <div className="admin-queue-stats">
          <span><strong>{depth?.running ?? 0}</strong> in flight</span>
          <span><strong>{depth?.pending ?? 0}</strong> waiting</span>
          <span className={depth?.failed ? 'admin-pending-count' : undefined}>
            <strong>{depth?.failed ?? 0}</strong> given up on
          </span>
          {timing && timing.calls > 0 && (
            <span className="admin-subtle">
              drafts (24h): {timing.calls}, avg {Math.round((timing.avg_ms ?? 0) / 100) / 10}s,
              worst {Math.round((timing.max_ms ?? 0) / 100) / 10}s
            </span>
          )}
        </div>
        <div className="admin-queue-actions">
          <button className="admin-btn" disabled={busy} onClick={onDrain}>
            {busy ? 'Working…' : 'Process one now'}
          </button>
          <button className="admin-btn" disabled={busy || !depth?.failed} onClick={onRetry}>
            Retry given-up
          </button>
        </div>
      </div>

      {rows.length === 0 && !loading && (
        <p className="admin-dim">
          Nothing outstanding. Every queued note has been written.
        </p>
      )}

      {rows.length > 0 && (
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Note</th>
                <th>User</th>
                <th>Queued</th>
                <th>Started</th>
                <th>Attempts</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><QueueStatus row={r} /></td>
                  <td>
                    {r.title}
                    <div className="admin-subtle">{r.space} · {r.source}</div>
                  </td>
                  <td>{r.email}</td>
                  <td title={formatDate(r.created_at)}>{ago(r.created_at)}</td>
                  <td title={r.started_at ? formatDate(r.started_at) : undefined}>{ago(r.started_at)}</td>
                  <td>{r.attempts}</td>
                  {/* Truncated in CSS, not here: the full text is the title
                      attribute, because the useful part of a model error is
                      usually at the end. */}
                  <td className="admin-queue-error" title={r.last_error ?? undefined}>
                    {r.last_error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(data?.recent.length ?? 0) > 0 && (
        <>
          {/* An empty queue looks identical whether it just finished or has
              been idle for a day. This is the difference. */}
          <div className="admin-label" style={{ marginTop: 22 }}>Recently written</div>
          <div className="admin-scroll">
            <table className="admin-table admin-table-compact">
              <thead><tr><th>Note</th><th>User</th><th>Finished</th><th>Attempts</th></tr></thead>
              <tbody>
                {data!.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}<div className="admin-subtle">{r.space}</div></td>
                    <td>{r.email}</td>
                    <td title={formatDate(r.updated_at)}>{ago(r.updated_at)}</td>
                    <td>{r.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
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
  const [demo, setDemo] = useState<{ visits: number; last_visit: string | null }>({ visits: 0, last_visit: null })
  const [usage, setUsage] = useState<AdminUsageResponse | null>(null)
  const [queue, setQueue] = useState<AdminQueueResponse | null>(null)
  const [queueBusy, setQueueBusy] = useState(false)
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
        : tab === 'queue'
        ? fetchQueue().then((data) => {
            setQueue(data)
            setTotal(data.rows.length)
          })
        : tab === 'usage'
        ? fetchUsage().then((data) => {
            setUsage(data)
            setTotal(data.models.length)
          })
        : tab === 'spaces'
        ? fetchSpaces().then((data) => {
            setSpaces(data.rows)
            setLibrary(data.library)
            setDemo(data.demo ?? { visits: 0, last_visit: null })
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

  // A queue is a live thing; a snapshot of it is out of date by the time it
  // renders. Poll while the tab is open, at the same 5s cadence as the app's
  // own status poll — and keep polling even when it is empty, because the
  // interesting event is work *arriving*.
  useEffect(() => {
    if (authState !== 'ok' || tab !== 'queue') return
    const id = setInterval(() => {
      fetchQueue().then(setQueue).catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [authState, tab])

  // Drafting is driven by the status poll, so with nobody in the app a queued
  // note waits indefinitely. This is the same drainQueue the poll calls.
  const runQueueAction = async (action: () => Promise<unknown>) => {
    setQueueBusy(true)
    setError(null)
    try {
      await action()
      setQueue(await fetchQueue())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setQueueBusy(false)
    }
  }

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

  /** Optimism would be wrong here: the row is the record of what the
   *  server thinks, and the whole point of the control is to change that. */
  const togglePlan = async (row: AdminUserRow) => {
    const next = row.plan_tier === 'pro' ? 'free' : 'pro'
    setBusy((b) => new Set(b).add(row.id))
    setError(null)
    try {
      const updated = await setPlan(row.id, next)
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, plan_tier: updated.planTier } : r)))
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
        <button
          role="tab"
          aria-selected={tab === 'queue'}
          className={`admin-tab${tab === 'queue' ? ' admin-tab-active' : ''}`}
          onClick={() => setTab('queue')}
        >
          Draft queue
          {(queue?.depth.pending ?? 0) + (queue?.depth.running ?? 0) > 0 && (
            <span className="admin-badge">{queue!.depth.pending + queue!.depth.running}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'usage'}
          className={`admin-tab${tab === 'usage' ? ' admin-tab-active' : ''}`}
          onClick={() => setTab('usage')}
        >
          Model usage
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {tab === 'queue' ? (
        <QueuePanel
          data={queue}
          loading={loading}
          busy={queueBusy}
          onDrain={() => runQueueAction(drainQueueNow)}
          onRetry={() => runQueueAction(retryFailedJobs)}
        />
      ) : tab === 'usage' ? (
        <>
          <p className="admin-dim">
            Our own measured consumption, computed from logged model calls — not read from
            the provider, which exposes no API for it. Limits are transcribed from the
            console for the free tier. Windows are rolling: RPM and TPM cover the last
            minute, RPD the last 24 hours.
          </p>
          <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Requests / min</th>
                <th>Tokens / min</th>
                <th>Requests / day</th>
                <th>All time</th>
                <th>Last call</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.models ?? []).map((m) => (
                <tr key={m.model}>
                  <td>
                    {m.model}
                    {m.model === usage?.activeModel && <span className="admin-badge">active</span>}
                    {!m.limits && <div className="admin-subtle">no limits on record</div>}
                  </td>
                  <td><Meter used={m.rpm} limit={m.limits?.rpm} /></td>
                  <td><Meter used={m.tpm} limit={m.limits?.tpm} /></td>
                  <td><Meter used={m.rpd} limit={m.limits?.rpd} /></td>
                  <td>{m.total}</td>
                  <td>{formatDate(m.last_call)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {!loading && (usage?.models.length ?? 0) === 0 && (
            <p className="admin-dim">No model calls logged yet.</p>
          )}
          {usage?.queue && (
            <p className="admin-dim" style={{ marginTop: 14 }}>
              Draft queue: <strong>{usage.queue.pending}</strong> waiting ·{' '}
              <strong>{usage.queue.running}</strong> in flight
              {usage.queue.failed > 0 && (
                <>
                  {' '}· <strong className="admin-pending-count">{usage.queue.failed}</strong> given up on
                </>
              )}
            </p>
          )}
          {(usage?.bySource.length ?? 0) > 0 && (
            <>
              <div className="admin-label" style={{ marginTop: 22 }}>What used it (last 24h)</div>
              <div className="admin-scroll">
              <table className="admin-table admin-table-compact">
                <thead><tr><th>Source</th><th>Calls</th></tr></thead>
                <tbody>
                  {usage!.bySource.map((s) => (
                    <tr key={s.source}><td>{s.source}</td><td>{s.calls}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </>
      ) : tab === 'spaces' ? (
        <>
          <p className="admin-dim">
            One row per space in a user's vault. A user with none has signed up but never
            generated anything. Reuse corpus: <strong>{library.spaces}</strong> space
            {library.spaces === 1 ? '' : 's'}, <strong>{library.notes}</strong> notes.
          </p>
          <p className="admin-dim">
            Demo page (<code>/demo</code>, no sign-in): <strong>{demo.visits}</strong> visit
            {demo.visits === 1 ? '' : 's'}
            {demo.last_visit ? <> · last {formatDate(demo.last_visit)}</> : null}
          </p>
          <div className="admin-scroll">
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
          </div>
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
          <div className="admin-scroll">
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
                    {/* Approving starts building this, so it belongs next to
                        the button that does it, not on another screen. */}
                    {!u.access_approved && u.requested_topic && (
                      <div className="admin-subtle">wants: {u.requested_topic}</div>
                    )}
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
          </div>
          {!loading && signins.length === 0 && <p className="admin-dim">No sign-ins recorded yet.</p>}
        </>
      ) : (
      <>
      <p className="admin-dim">{total} user{total === 1 ? '' : 's'}</p>
      <div className="admin-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Plan</th>
            <th>Notes</th>
            <th>Completed</th>
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
              {/* Stops the row click from opening the detail panel behind
                  the toggle — the two are different intentions. */}
              <td onClick={(e) => e.stopPropagation()}>
                <button
                  className={'admin-plan' + (u.plan_tier === 'pro' ? ' is-pro' : '')}
                  disabled={busy.has(u.id)}
                  title={u.plan_tier === 'pro' ? 'Switch to free' : 'Switch to pro'}
                  onClick={() => void togglePlan(u)}
                >
                  {u.plan_tier}
                </button>
              </td>
              <td>{u.note_count}</td>
              {/* Out of topics, not out of notes: note_count includes Next
                  Up, _config and templates, which nobody completes, so that
                  denominator would understate every user. */}
              <td>
                {u.reviewed_count}
                {u.topic_count > 0 && (
                  <span className="admin-subtle"> / {u.topic_count}</span>
                )}
              </td>
              <td>{formatBytes(u.storage_bytes)}</td>
              <td>{u.llm_calls_this_month}</td>
              <td>{formatDate(u.created_at)}</td>
              <td>{formatDate(u.last_login_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </>
      )}
      {loading && <p className="admin-dim">Loading…</p>}

      {/* /spaces returns every row at once — it is one row per space, not per
          note, so it stays small. Showing a pager there would imply pages
          that do not exist. */}
      {tab !== 'spaces' && tab !== 'queue' && (
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
              <div className="admin-scroll">
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
