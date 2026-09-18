import type { Request, Response, NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'

export const SESSION_COOKIE = 'kb_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const [row] = await db.insert(sessions).values({ userId, expiresAt }).returning({ id: sessions.id })
  return { id: row.id, expiresAt }
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProd(),
    // Frontend and API are served same-site in production (see deployment
    // plan); SameSite=Lax is enough there and avoids the Secure+cross-site
    // requirement that breaks on Safari/iOS. Local dev proxies /api and
    // /auth through the Vite dev server so it's same-origin too.
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export interface AuthedUser {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  planTier: string
  accessApproved: boolean
  accessRequestedAt: Date | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
      sessionId?: string
    }
  }
}

async function resolveSession(sessionId: string | undefined): Promise<AuthedUser | null> {
  if (!sessionId) return null
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      planTier: users.planTier,
      accessApproved: users.accessApproved,
      accessRequestedAt: users.accessRequestedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    role: row.role,
    planTier: row.planTier,
    // Owners are approved by definition — the approval gate exists to let the
    // owner admit other people, and an owner who could lock themselves out of
    // their own instance would be a footgun with no upside.
    accessApproved: row.role === 'owner' || row.accessApproved,
    accessRequestedAt: row.accessRequestedAt,
  }
}

/** Attaches req.user if a valid session cookie is present. Never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined
  req.sessionId = sessionId
  req.user = (await resolveSession(sessionId)) ?? undefined
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'not authenticated' })
    return
  }
  next()
}

/** Gate for anything that consumes the owner's own resources — cloud vault
 * storage and LLM calls billed to the owner's API key. The demo vault and the
 * user's own local folder are entirely client-side and are NOT gated here.
 *
 * Returns a distinct `code` so the frontend can tell "you need to be let in"
 * apart from a generic 403 and show the early-access prompt instead of an
 * error. */
export function requireApproved(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'not authenticated' })
    return
  }
  if (!req.user.accessApproved) {
    res.status(403).json({ error: 'Your account is awaiting approval for early access.', code: 'not_approved' })
    return
  }
  next()
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'owner') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}

export async function destroySession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}
