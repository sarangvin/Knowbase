// Everything the app asks for as it opens, in one request.
//
// Opening the app used to send five requests at once — streak, collection
// allowance, library spaces, onboarding status, reminder settings — and
// against a cold function Vercel booted an instance for several of them.
// This answers all five; the client hands each part to the code that used
// to fetch it (src/bootstrap.ts), and their own routes still serve every
// later refresh and poll.
//
// Each part fails on its own: null in place of what could not be read, so
// the client falls back to that part's own route rather than losing all
// five to one bad query. Like /library/spaces, this answers without a
// session — the landing page shows library spaces before sign-in — and the
// account parts are then null.
import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { streakFor } from './account.js'
import { coinsFor } from '../usage/coins.js'
import { allowanceFor, statusFor } from './onboarding.js'
import { notificationStatusFor } from './notifications.js'
import { librarySpaces } from './vaults.js'

export const bootstrapRouter = Router()

async function part<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    console.error(`[bootstrap] ${name} failed`, err)
    return null
  }
}

bootstrapRouter.get('/', asyncHandler(async (req, res) => {
  const day = typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : null
  const user = req.user
  // One after another, not Promise.all: the instance has one database
  // connection (db/client.ts), so they would queue for it regardless.
  const library = await part('library', librarySpaces)
  if (!user) {
    res.json({ library, streak: null, coins: null, allowance: null, onboarding: null, notifications: null })
    return
  }
  res.json({
    library,
    streak: day ? await part('streak', () => streakFor(user.id, day)) : null,
    coins: await part('coins', () => coinsFor(user.id)),
    allowance: await part('allowance', () => allowanceFor(user, day ?? '')),
    onboarding: await part('onboarding', () => statusFor(user.id)),
    notifications: await part('notifications', () => notificationStatusFor(user.id)),
  })
}))
