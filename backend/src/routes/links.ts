// Short links for the posting scripts: `/r/<code>` instead of
// `/?read=Human%20Ancestry%20and%20Migration&ref=ig-fact`.
//
// A link only ever leads inside the app — the front page, or a library
// collection's preview, with a `ref` for sign-up attribution — so creating
// one needs no secret: there is nothing to redirect to except this app. The
// code is derived from the collection and the ref, so asking twice gives the
// same code, and the table cannot hold more than one row per collection and
// channel.
import { createHash } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { shortLinks } from '../db/schema.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { findLibrarySpaceFor } from '../vault/spaces.js'

export const linksRouter = Router()

const ALPHABET = '0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_LEN = 6
const REF_RE = /^[a-z0-9][a-z0-9-]{0,23}$/

/** Six characters from a hash of the target. 57^6 is ~34 billion codes, so a
 *  collision between two real links is not a practical concern. No l, o, I
 *  or O: a code read off a screen should not be ambiguous. */
export function codeFor(space: string | null, ref: string | null): string {
  const digest = createHash('sha256').update(`${space ?? ''}\u0000${ref ?? ''}`).digest()
  let n = digest.readBigUInt64BE(0)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[Number(n % BigInt(ALPHABET.length))]
    n /= BigInt(ALPHABET.length)
  }
  return out
}

export function targetOf(space: string | null, ref: string | null): string {
  const q = new URLSearchParams()
  if (space) q.set('read', space)
  if (ref) q.set('ref', ref)
  const s = q.toString().replace(/\+/g, '%20')
  return s ? `/?${s}` : '/'
}

/** POST /api/links { space?, ref? } -> { code, path } */
linksRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const rawSpace = typeof req.body?.space === 'string' ? req.body.space.trim() : ''
  const rawRef = typeof req.body?.ref === 'string' ? req.body.ref.trim().toLowerCase() : ''
  if (rawRef && !REF_RE.test(rawRef)) {
    res.status(400).json({ error: 'ref must be lowercase letters, digits and dashes, up to 24' })
    return
  }
  // Only collections the library actually has, under the library's own name.
  const space = rawSpace ? await findLibrarySpaceFor(rawSpace) : null
  if (rawSpace && !space) {
    res.status(404).json({ error: 'No library collection by that name' })
    return
  }
  const ref = rawRef || null
  const code = codeFor(space, ref)
  await db.insert(shortLinks).values({ code, space, ref }).onConflictDoNothing({ target: shortLinks.code })
  res.json({ code, path: `/r/${code}`, target: targetOf(space, ref) })
}))

/** GET /r/:code — the redirect itself. An unknown code goes to the front
 *  page rather than an error: whoever tapped it still wanted the app. */
export const redirectShortLink = asyncHandler(async (req: Request, res: Response) => {
  const code = String(req.params.code ?? '')
  const [row] = /^[0-9a-zA-Z]{4,12}$/.test(code)
    ? await db
        .update(shortLinks)
        .set({ clicks: sql`${shortLinks.clicks} + 1`, lastClickAt: new Date() })
        .where(eq(shortLinks.code, code))
        .returning({ space: shortLinks.space, ref: shortLinks.ref })
    : []
  res.set('Cache-Control', 'no-store')
  res.redirect(302, row ? targetOf(row.space, row.ref) : '/')
})
