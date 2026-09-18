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
