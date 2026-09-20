// Server-side completion of a new space's note drafts.
//
// This used to run in the browser after onboarding handed the user their
// vault. That worked only as long as the tab stayed open: close it, lock the
// phone, or switch apps and the remaining notes were simply never written,
// leaving a vault permanently stuck on one-line summaries with no way to
// retry. Doing it here means the work survives the client.
//
// The request returns 202 immediately and the drafting continues under
// waitUntil, so the caller never waits and a dropped connection doesn't kill
// the job.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { waitUntil } from '@vercel/functions'
import { db } from '../db/client.js'
import { notes, vaults } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { validateVaultPath, PathError } from '../vault/pathValidation.js'
import { DEFAULT_GEMINI_MODEL } from '../llm/providers/gemini.js'
import { draftOne, type DraftRequestItem } from '../onboarding/draftNote.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const draftNotesRouter = Router()
draftNotesRouter.use(requireAuth)
draftNotesRouter.use(requireApproved)

const MAX_DRAFTS = 12

draftNotesRouter.post('/', asyncHandler(async (req, res) => {
  const space = typeof req.body?.space === 'string' ? req.body.space : null
  const raw = req.body?.items
  if (!space || !Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DRAFTS) {
    res.status(400).json({ error: `body.space and body.items (1-${MAX_DRAFTS}) required` })
    return
  }

  const items: DraftRequestItem[] = []
  for (const it of raw) {
    if (
      typeof it?.path !== 'string' ||
      typeof it?.title !== 'string' ||
      typeof it?.summary !== 'string' ||
      typeof it?.placeholder !== 'string'
    ) {
      res.status(400).json({ error: 'each item needs path, title, summary, placeholder' })
      return
    }
    try {
      items.push({ ...it, path: validateVaultPath(it.path) })
    } catch (err) {
      res.status(400).json({ error: err instanceof PathError ? err.message : 'invalid path' })
      return
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // Not the user's problem and not recoverable by retrying: their notes are
    // already saved, they just keep the summaries.
    res.status(202).json({ started: 0, reason: 'llm not configured' })
    return
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const userId = req.user!.id
  const siblings = items.map((i) => i.title)

  res.status(202).json({ started: items.length })

  // After the response. waitUntil keeps the invocation alive so a client that
  // navigates away, backgrounds the tab or loses signal doesn't abort this.
  waitUntil(
    (async () => {
      const vaultRows = await db
        .select({ id: vaults.id })
        .from(vaults)
        .where(and(eq(vaults.ownerUserId, userId), eq(vaults.kind, 'personal')))
        .limit(1)
      const vaultId = vaultRows[0]?.id
      if (!vaultId) return

      // Sequential, not parallel: the free tier is rate-limited per user and
      // five concurrent calls is the fastest way to trip it. Nobody is
      // waiting on this, so latency is not the constraint it was client-side.
      for (const item of items) {
        const content = await draftOne(apiKey, model, space, item, siblings)
        if (!content) continue
        // Re-read immediately before writing: the user has their vault open
        // and may well have edited this very note while we were drafting it.
        const existing = await db
          .select({ content: notes.content })
          .from(notes)
          .where(and(eq(notes.vaultId, vaultId), eq(notes.path, item.path)))
          .limit(1)
        if (!existing[0] || existing[0].content !== item.placeholder) continue
        await db
          .update(notes)
          .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
          .where(and(eq(notes.vaultId, vaultId), eq(notes.path, item.path)))
        void logUsageEvent({ userId, eventType: 'note_write', metadata: { vault: 'personal', path: item.path, source: 'background-draft' } })
      }
    })().catch((err) => console.error('[draft-notes] background pass failed', err)),
  )
}))
