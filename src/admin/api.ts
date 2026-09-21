export interface AdminUserRow {
  id: string
  email: string
  display_name: string | null
  role: string
  plan_tier: string
  created_at: string
  last_login_at: string | null
  note_count: number
  storage_bytes: number
  llm_calls_this_month: number
}

export interface AdminUsersResponse {
  users: AdminUserRow[]
  page: number
  pageSize: number
  total: number
}

export interface AdminSigninRow {
  id: string
  email: string
  /** Three-valued: Google said verified / said not verified / never observed. */
  email_verified: boolean | null
  display_name: string | null
  role: string
  /** Owner approval — distinct from email_verified above. */
  access_approved: boolean
  access_approved_at: string | null
  access_requested_at: string | null
  /** What they asked to learn on the landing screen. Approving them starts
   *  building it, so this is worth seeing before you decide. */
  requested_topic: string | null
  created_at: string
  last_login_at: string
  login_count: number
}

export interface AdminSigninsResponse {
  signins: AdminSigninRow[]
  page: number
  pageSize: number
  total: number
  verified: number
  unverified: number
  unknown: number
  approved: number
  pending: number
}

export interface AdminSpaceRow {
  user_id: string
  email: string
  role: string
  access_approved: boolean
  /** Exact: when their personal vault row was created. Null if they have none. */
  vault_created: string | null
  /** Null when the user has signed up but generated nothing. */
  space: string | null
  note_count: number
  /** Approximate — oldest surviving note mtime, since notes have no created_at. */
  first_seen: string | null
  last_updated: string | null
}

export interface AdminSpacesResponse {
  rows: AdminSpaceRow[]
  library: { spaces: number; notes: number }
  /** Traffic to the unauthenticated /demo page, which has no vault of its own. */
  demo: { visits: number; last_visit: string | null }
}

export interface ModelUsageRow {
  model: string
  /** Requests in the last rolling minute. */
  rpm: number
  /** Tokens (in + out) in the last rolling minute. */
  tpm: number
  /** Requests in the last rolling 24 hours. */
  rpd: number
  total: number
  last_call: string | null
  /** Null for a model we have no transcribed limits for. */
  limits: { rpm: number; tpm: number; rpd: number } | null
}

export interface AdminUsageResponse {
  models: ModelUsageRow[]
  bySource: { source: string; calls: number }[]
  activeModel: string
  /** Outstanding note-drafting work (backend/src/onboarding/queue.ts). */
  queue?: { pending: number; running: number; failed: number }
}

export interface UsageEventRow {
  id: number
  event_type: string
  provider: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  latency_ms: number | null
  metadata: Record<string, unknown> | null
  created_at: string
}

/** One draft_queue row (backend/src/onboarding/queue.ts). */
export interface AdminQueueRow {
  id: string
  status: 'pending' | 'running' | 'done' | 'failed'
  attempts: number
  last_error: string | null
  source: string
  space: string
  title: string
  path: string
  email: string
  created_at: string
  started_at: string | null
  updated_at: string
  /** Running AND started recently enough to be the job actually holding the
   *  queue — not merely a row left in 'running' by a killed invocation. */
  in_flight: boolean
}

export interface AdminQueueResponse {
  depth: { pending: number; running: number; failed: number }
  /** Everything not done, running first, then oldest pending. */
  rows: AdminQueueRow[]
  /** Last 20 finished, so "quiet" can be told from "stalled". */
  recent: AdminQueueRow[]
  timing: { calls: number; avg_ms: number | null; max_ms: number | null }
}

export interface AdminUserDetail {
  user: {
    id: string
    email: string
    displayName: string | null
    avatarUrl: string | null
    role: string
    planTier: string
    createdAt: string
    lastLoginAt: string | null
  }
  subscription: { status: string; planTier: string; currentPeriodEnd: string | null } | null
  recentEvents: UsageEventRow[]
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const err = new Error(`${path} failed: ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

export function fetchUsers(page: number, pageSize = 20): Promise<AdminUsersResponse> {
  return api(`/api/admin/users?page=${page}&pageSize=${pageSize}`)
}

export function fetchSignins(page: number, pageSize = 20): Promise<AdminSigninsResponse> {
  return api(`/api/admin/signins?page=${page}&pageSize=${pageSize}`)
}

export function fetchSpaces(): Promise<AdminSpacesResponse> {
  return api('/api/admin/spaces')
}

export function fetchUsage(): Promise<AdminUsageResponse> {
  return api('/api/admin/usage')
}

export function fetchQueue(): Promise<AdminQueueResponse> {
  return api('/api/admin/queue')
}

export function drainQueueNow(): Promise<{ reconciled: number; drained: unknown; depth: AdminQueueResponse['depth'] }> {
  return api('/api/admin/queue/drain', { method: 'POST' })
}

export function retryFailedJobs(): Promise<{ requeued: number; depth: AdminQueueResponse['depth'] }> {
  return api('/api/admin/queue/retry', { method: 'POST' })
}

export function setApproved(id: string, approved: boolean): Promise<{ access_approved: boolean; access_approved_at: string | null }> {
  return api(`/api/admin/users/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  })
}

export function fetchUserDetail(id: string): Promise<AdminUserDetail> {
  return api(`/api/admin/users/${id}`)
}

export function fetchCurrentUser(): Promise<{ id: string; email: string; role: string } | null> {
  return fetch('/auth/me', { credentials: 'include' })
    .then((res) => res.json())
    .then((data) => data.user)
}
