// Google OAuth Authorization Code flow, handled entirely server-side (never
// the client-side "One Tap" id_token pattern, which would let the browser
// self-report identity without the backend verifying anything).
import { randomBytes, createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { createSession, setSessionCookie } from './session.js'
import { logUsageEvent } from '../usage/logEvent.js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

const OAUTH_STATE_COOKIE = 'kb_oauth_state'

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface OAuthState {
  state: string
  codeVerifier: string
  returnTo: string
}

export function googleAuthStart(req: Request, res: Response): void {
  const clientId = requiredEnv('GOOGLE_CLIENT_ID')
  const redirectUri = requiredEnv('GOOGLE_REDIRECT_URI')

  const state = base64url(randomBytes(24))
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/'

  const payload: OAuthState = { state, codeVerifier, returnTo }
  res.cookie(OAUTH_STATE_COOKIE, Buffer.from(JSON.stringify(payload)).toString('base64url'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/auth/google',
  })

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')

  res.redirect(url.toString())
}

interface GoogleTokenResponse {
  access_token: string
  id_token: string
  expires_in: number
}

interface GoogleUserInfo {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

export async function googleAuthCallback(req: Request, res: Response): Promise<void> {
  const rawState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/auth/google' })

  const code = typeof req.query.code === 'string' ? req.query.code : undefined
  const returnedState = typeof req.query.state === 'string' ? req.query.state : undefined

  if (!rawState || !code || !returnedState) {
    res.status(400).send('Missing OAuth parameters')
    return
  }

  let expected: OAuthState
  try {
    expected = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8')) as OAuthState
  } catch {
    res.status(400).send('Invalid OAuth state')
    return
  }

  if (expected.state !== returnedState) {
    res.status(400).send('OAuth state mismatch — possible CSRF, please try signing in again')
    return
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: requiredEnv('GOOGLE_REDIRECT_URI'),
      grant_type: 'authorization_code',
      code,
      code_verifier: expected.codeVerifier,
    }),
  })
  if (!tokenRes.ok) {
    res.status(502).send('Google token exchange failed')
    return
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!profileRes.ok) {
    res.status(502).send('Fetching Google profile failed')
    return
  }
  const profile = (await profileRes.json()) as GoogleUserInfo

  const existing = await db.select().from(users).where(eq(users.googleSub, profile.sub)).limit(1)
  let userId: string
  if (existing[0]) {
    userId = existing[0].id
    await db
      .update(users)
      .set({
        email: profile.email,
        displayName: profile.name ?? existing[0].displayName,
        avatarUrl: profile.picture ?? existing[0].avatarUrl,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, userId))
  } else {
    const ownerEmails = (process.env.OWNER_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    const role = ownerEmails.includes(profile.email.toLowerCase()) ? 'owner' : 'user'
    const [row] = await db
      .insert(users)
      .values({
        googleSub: profile.sub,
        email: profile.email,
        displayName: profile.name,
        avatarUrl: profile.picture,
        role,
        lastLoginAt: new Date(),
      })
      .returning({ id: users.id })
    userId = row.id
  }

  const session = await createSession(userId)
  setSessionCookie(res, session.id, session.expiresAt)
  await logUsageEvent({ userId, eventType: 'login' })

  const appUrl = requiredEnv('APP_URL')
  res.redirect(`${appUrl}${expected.returnTo.startsWith('/') ? expected.returnTo : '/'}`)
}
