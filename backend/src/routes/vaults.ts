// "mine/*" = the caller's personal vault merged with the read-only global
// vault (origin-tagged, personal shadows global on path collision — the same
// "local overlay wins" rule SeedVaultSource already uses for the bundled demo
// vault). "global/*" = the raw global vault, owner-only, for editing it.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, vaults } from '../db/schema.js'
import { requireAuth, requireOwner } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { validateVaultPath, PathError } from '../vault/pathValidation.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const vaultsRouter = Router()
vaultsRouter.use(requireAuth)

/** vault_id is always derived from the session — never accepted from the client. */
async function getOrCreatePersonalVaultId(userId: string): Promise<string> {
  const existing = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(and(eq(vaults.ownerUserId, userId), eq(vaults.kind, 'personal')))
    .limit(1)
  if (existing[0]) return existing[0].id

  const [row] = await db
    .insert(vaults)
    .values({ ownerUserId: userId, kind: 'personal', name: 'My Vault' })
    .returning({ id: vaults.id })
  return row.id
}

/** Null if the global vault hasn't been seeded yet (see db/seedGlobalVault.ts). */
async function getGlobalVaultId(): Promise<string | null> {
  const existing = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.kind, 'global')).limit(1)
  return existing[0]?.id ?? null
}

function parsePathParam(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string') return { error: 'path query param required' }
  try {
    return validateVaultPath(raw)
  } catch (err) {
    return { error: err instanceof PathError ? err.message : 'invalid path' }
  }
}

vaultsRouter.get('/mine/notes', asyncHandler(async (req, res) => {
  const personalVaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const globalVaultId = await getGlobalVaultId()

  const personalRows = await db
    .select({ path: notes.path, sizeBytes: notes.sizeBytes, mtime: notes.mtime })
    .from(notes)
    .where(eq(notes.vaultId, personalVaultId))
  const globalRows = globalVaultId
    ? await db
        .select({ path: notes.path, sizeBytes: notes.sizeBytes, mtime: notes.mtime })
        .from(notes)
        .where(eq(notes.vaultId, globalVaultId))
    : []

  const personalPaths = new Set(personalRows.map((r) => r.path))
  const merged = [
    ...personalRows.map((r) => ({ ...r, origin: 'personal' as const })),
    // Personal shadows global on a path collision — global rows for paths the
    // user already has a personal note at are dropped from the merged view.
    ...globalRows.filter((r) => !personalPaths.has(r.path)).map((r) => ({ ...r, origin: 'global' as const })),
  ]

  res.json(
    merged.map((r) => ({
      path: r.path,
      type: 'note' as const,
      ext: 'md',
      size: r.sizeBytes,
      mtime: r.mtime.getTime(),
      origin: r.origin,
    })),
  )
  // Fire-and-forget: logUsageEvent swallows its own errors, and the response
  // is already on its way — don't make the user wait on telemetry.
  void logUsageEvent({ userId: req.user!.id, eventType: 'vault_sync' })
}))

vaultsRouter.get('/mine/note', asyncHandler(async (req, res) => {
  const parsed = parsePathParam(req.query.path)
  if (typeof parsed !== 'string') {
    res.status(400).json(parsed)
    return
  }
  const path = parsed

  const personalVaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const personal = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, personalVaultId), eq(notes.path, path)))
    .limit(1)
  if (personal[0]) {
    res.json({ content: personal[0].content })
    return
  }

  const globalVaultId = await getGlobalVaultId()
  if (globalVaultId) {
    const global = await db
      .select({ content: notes.content })
      .from(notes)
      .where(and(eq(notes.vaultId, globalVaultId), eq(notes.path, path)))
      .limit(1)
    if (global[0]) {
      res.json({ content: global[0].content })
      return
    }
  }

  res.status(404).json({ error: 'note not found' })
}))

// Writing through "mine" always targets the personal vault — there is no
// vault selector here by design, so a non-owner has no route through which to
// touch the global vault's rows at all (see the owner-only /global/* routes
// below, which 403 for anyone else). A write to a path that currently
// resolves to a global note simply creates a personal note at that path,
// shadowing it going forward — identical to how editing a bundled demo note
// today saves into the user's own IndexedDB overlay rather than the original.
vaultsRouter.put('/mine/note', asyncHandler(async (req, res) => {
  const parsed = parsePathParam(req.query.path)
  if (typeof parsed !== 'string') {
    res.status(400).json(parsed)
    return
  }
  const path = parsed
  const content = req.body?.content
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'body.content (string) required' })
    return
  }

  const vaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const sizeBytes = Buffer.byteLength(content, 'utf8')
  await db
    .insert(notes)
    .values({ vaultId, path, content, sizeBytes, mtime: new Date() })
    .onConflictDoUpdate({
      target: [notes.vaultId, notes.path],
      set: { content, sizeBytes, mtime: new Date() },
    })
  res.status(204).end()
  void logUsageEvent({ userId: req.user!.id, eventType: 'note_write', metadata: { vault: 'personal', path } })
}))

// Asset metadata only for now — binary upload/serving lands with the S3-backed
// storage_key wiring; the route exists so the frontend's assetUrl() call has
// somewhere to land without a 404 while a vault has zero assets.
vaultsRouter.get('/mine/assets', asyncHandler(async (_req, res) => {
  res.json([])
}))

// ── Owner-only: editing the raw global vault directly ───────────────────────
const globalRouter = Router()
globalRouter.use(requireOwner)

async function requireGlobalVaultId(res: import('express').Response): Promise<string | null> {
  const id = await getGlobalVaultId()
  if (!id) res.status(404).json({ error: 'global vault not seeded yet — run db:seed-global' })
  return id
}

globalRouter.get('/notes', asyncHandler(async (_req, res) => {
  const vaultId = await requireGlobalVaultId(res)
  if (!vaultId) return
  const rows = await db
    .select({ path: notes.path, sizeBytes: notes.sizeBytes, mtime: notes.mtime })
    .from(notes)
    .where(eq(notes.vaultId, vaultId))
  res.json(
    rows.map((r) => ({ path: r.path, type: 'note' as const, ext: 'md', size: r.sizeBytes, mtime: r.mtime.getTime(), origin: 'global' as const })),
  )
}))

globalRouter.get('/note', asyncHandler(async (req, res) => {
  const parsed = parsePathParam(req.query.path)
  if (typeof parsed !== 'string') {
    res.status(400).json(parsed)
    return
  }
  const vaultId = await requireGlobalVaultId(res)
  if (!vaultId) return
  const rows = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, parsed)))
    .limit(1)
  if (!rows[0]) {
    res.status(404).json({ error: 'note not found' })
    return
  }
  res.json({ content: rows[0].content })
}))

globalRouter.put('/note', asyncHandler(async (req, res) => {
  const parsed = parsePathParam(req.query.path)
  if (typeof parsed !== 'string') {
    res.status(400).json(parsed)
    return
  }
  const content = req.body?.content
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'body.content (string) required' })
    return
  }
  const vaultId = await requireGlobalVaultId(res)
  if (!vaultId) return

  const sizeBytes = Buffer.byteLength(content, 'utf8')
  await db
    .insert(notes)
    .values({ vaultId, path: parsed, content, sizeBytes, mtime: new Date() })
    .onConflictDoUpdate({
      target: [notes.vaultId, notes.path],
      set: { content, sizeBytes, mtime: new Date() },
    })
  res.status(204).end()
  void logUsageEvent({ userId: req.user!.id, eventType: 'note_write', metadata: { vault: 'global', path: parsed } })
}))

globalRouter.get('/assets', asyncHandler(async (_req, res) => {
  res.json([])
}))

vaultsRouter.use('/global', globalRouter)
