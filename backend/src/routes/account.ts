// Destructive account operations, kept in their own file so they are easy to
// find and hard to reach by accident.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, assets, vaults, onboardingJobs } from '../db/schema.js'
import { requireAuth } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const accountRouter = Router()
// Auth, but deliberately NOT requireApproved: someone whose access was
// revoked, or who never got it, must still be able to clear their own data.
accountRouter.use(requireAuth)

/**
 * Wipe the caller's own vault: every note and asset in their personal vault,
 * plus their onboarding job so a fresh space can be generated afterwards.
 *
 * What it deliberately does NOT touch:
 *   • the global vault / reuse corpus — those notes are no longer theirs
 *     alone, other people's spaces were seeded from them, and deleting a
 *     shared corpus from a personal reset would be a surprising blast radius;
 *   • the user row itself, including role and access approval, so they keep
 *     their account and don't have to be re-approved to start again.
 *
 * The user id comes from the session and nothing else. There is no parameter
 * by which one account could ask for another's data to be deleted.
 */
accountRouter.post('/reset', asyncHandler(async (req, res) => {
  // A second, explicit confirmation on the wire. The UI already asks, but a
  // destructive endpoint that fires on an empty POST is one stray fetch away
  // from deleting someone's work.
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: 'body.confirm must be true' })
    return
  }

  const userId = req.user!.id
  const personal = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(and(eq(vaults.ownerUserId, userId), eq(vaults.kind, 'personal')))
    .limit(1)

  let deletedNotes = 0
  if (personal[0]) {
    const vaultId = personal[0].id
    const gone = await db.delete(notes).where(eq(notes.vaultId, vaultId)).returning({ path: notes.path })
    deletedNotes = gone.length
    await db.delete(assets).where(eq(assets.vaultId, vaultId))
    // The vault row itself stays. getOrCreatePersonalVaultId would just make
    // another one, and keeping it means its created_at still records when
    // this person actually started rather than when they last reset.
  }

  // Without this the onboarding job stays 'ready' and points at a space that
  // no longer exists, so the user would never be offered a new one.
  await db.delete(onboardingJobs).where(eq(onboardingJobs.userId, userId))

  void logUsageEvent({ userId, eventType: 'vault_sync', metadata: { reset: true, deletedNotes } })
  res.json({ ok: true, deletedNotes })
}))
