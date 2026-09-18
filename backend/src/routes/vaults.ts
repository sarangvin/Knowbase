// "mine/*" = the caller's personal vault, and ONLY that. The global vault
// used to be merged into every user's listing; it isn't any more. Merging
// meant every user's file tree filled up with every other user's topics as
// the corpus grew, which does not survive more than a handful of users.
//
// The global vault now has two jobs, neither of which is "appear in someone
// else's sidebar":
//   • the owner's own curated vault, edited through the owner-only /global/*
//     routes below;
//   • a reuse corpus — /library/spaces lists what has already been written,
//     /mine/adopt copies a space into a user's own vault, and /library/
//     contribute adds newly generated drafts. Users never see it directly;
//     they get their own copy or nothing.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, vaults } from '../db/schema.js'
import { requireAuth, requireApproved, requireOwner } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { validateVaultPath, PathError } from '../vault/pathValidation.js'
import { logUsageEvent } from '../usage/logEvent.js'

export const vaultsRouter = Router()
vaultsRouter.use(requireAuth)
// Cloud vaults are the owner's storage, so they're behind owner approval.
// The demo vault and "open my own folder" are pure client-side and never
// reach this router, which is what an unapproved user is left with.
vaultsRouter.use(requireApproved)

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

  const personalRows = await db
    .select({ path: notes.path, sizeBytes: notes.sizeBytes, mtime: notes.mtime })
    .from(notes)
    .where(eq(notes.vaultId, personalVaultId))

  // origin is still reported, and is still always 'personal' here. App.tsx
  // keys its "brand new vault" check off it, and keeping the field means a
  // client that predates this change reads an empty global set rather than
  // an undefined one.
  const merged = personalRows.map((r) => ({ ...r, origin: 'personal' as const }))

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

  // No global fallback: a user reads their own notes only. Content from the
  // corpus reaches them by being copied into their vault (/mine/adopt), never
  // by being read through from someone else's.
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

// ── Reuse corpus ────────────────────────────────────────────────────────────
//
// Spaces already written, so the eleventh person to ask for Kubernetes gets a
// copy instead of six more model calls. Backed by the global vault, but users
// never read through to it: they get their own copy in their own vault, which
// they can then edit without affecting anyone else.

const SPACE_ROOT = 'Automated Graph/'

/** "Automated Graph/Economics/Topics/x.md" -> "Economics". Null for anything
 * outside that layout, which the corpus doesn't describe. */
function spaceOf(path: string): string | null {
  if (!path.startsWith(SPACE_ROOT)) return null
  const rest = path.slice(SPACE_ROOT.length)
  const slash = rest.indexOf('/')
  return slash > 0 ? rest.slice(0, slash) : null
}

/** Match key for "do we already have this topic?". Deliberately conservative:
 * case and punctuation are noise, but anything cleverer (stemming, embeddings)
 * risks handing someone a space about a different subject, which is far worse
 * than regenerating one. */
function normalizeTopic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

vaultsRouter.get('/library/spaces', asyncHandler(async (_req, res) => {
  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) {
    res.json({ spaces: [] })
    return
  }
  const rows = await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, globalVaultId))
  const counts = new Map<string, number>()
  for (const r of rows) {
    const space = spaceOf(r.path)
    if (space) counts.set(space, (counts.get(space) ?? 0) + 1)
  }
  res.json({
    spaces: [...counts].map(([name, noteCount]) => ({ name, key: normalizeTopic(name), noteCount })),
  })
}))

/** Copy one corpus space into the caller's own vault. Paths the user already
 * has are skipped, never overwritten — adopting must not clobber work. */
vaultsRouter.post('/mine/adopt', asyncHandler(async (req, res) => {
  const space = typeof req.body?.space === 'string' ? req.body.space : null
  if (!space || space.includes('/')) {
    res.status(400).json({ error: 'body.space (a single space name) required' })
    return
  }

  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) {
    res.status(404).json({ error: 'nothing in the library yet' })
    return
  }

  const source = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(eq(notes.vaultId, globalVaultId))
  const wanted = source.filter((r) => spaceOf(r.path) === space)
  if (wanted.length === 0) {
    res.status(404).json({ error: 'no such space in the library' })
    return
  }

  const personalVaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const existing = new Set(
    (await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, personalVaultId))).map((r) => r.path),
  )
  const toInsert = wanted.filter((r) => !existing.has(r.path))

  if (toInsert.length > 0) {
    await db.insert(notes).values(
      toInsert.map((r) => ({
        vaultId: personalVaultId,
        path: r.path,
        content: r.content,
        sizeBytes: Buffer.byteLength(r.content, 'utf8'),
        mtime: new Date(),
      })),
    )
  }

  res.json({
    adopted: toInsert.length,
    skipped: wanted.length - toInsert.length,
    openPath: `${SPACE_ROOT}${space}/Next Up.md`,
  })
  void logUsageEvent({ userId: req.user!.id, eventType: 'vault_sync', metadata: { adopted: space } })
}))

const MAX_CONTRIBUTION_NOTES = 40
const MAX_CONTRIBUTION_BYTES = 512 * 1024

/** Add freshly generated drafts to the corpus.
 *
 * This is the one place a non-owner writes to the global vault, so it is
 * insert-only: onConflictDoNothing means an existing note — including
 * anything the owner has curated — can never be modified or replaced through
 * here. The worst a caller can do is add a path nobody was using, which the
 * owner can delete from the global-edit view.
 *
 * Only AI-drafted content is sent (see the client), captured at creation
 * before the user has edited anything, so nothing anyone considers private
 * passes through this route. */
vaultsRouter.post('/library/contribute', asyncHandler(async (req, res) => {
  const raw = req.body?.entries
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CONTRIBUTION_NOTES) {
    res.status(400).json({ error: `body.entries must be 1-${MAX_CONTRIBUTION_NOTES} notes` })
    return
  }

  const entries: { path: string; content: string }[] = []
  let total = 0
  for (const e of raw) {
    if (typeof e?.path !== 'string' || typeof e?.content !== 'string') {
      res.status(400).json({ error: 'each entry needs a string path and content' })
      return
    }
    let path: string
    try {
      path = validateVaultPath(e.path)
    } catch (err) {
      res.status(400).json({ error: err instanceof PathError ? err.message : 'invalid path' })
      return
    }
    // Confine contributions to the generated-space layout. Without this a
    // caller could drop a file anywhere in the owner's vault, including over
    // a path the owner intends to use later.
    if (!spaceOf(path)) {
      res.status(400).json({ error: `contributions must live under ${SPACE_ROOT}<space>/` })
      return
    }
    total += Buffer.byteLength(e.content, 'utf8')
    if (total > MAX_CONTRIBUTION_BYTES) {
      res.status(413).json({ error: 'contribution too large' })
      return
    }
    entries.push({ path, content: e.content })
  }

  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) {
    // Not an error the user caused or can fix, and their own notes are
    // already saved — the corpus simply doesn't exist yet.
    res.json({ added: 0, reason: 'no global vault' })
    return
  }

  const before = new Set(
    (await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, globalVaultId))).map((r) => r.path),
  )
  const fresh = entries.filter((e) => !before.has(e.path))
  if (fresh.length > 0) {
    await db
      .insert(notes)
      .values(
        fresh.map((e) => ({
          vaultId: globalVaultId,
          path: e.path,
          content: e.content,
          sizeBytes: Buffer.byteLength(e.content, 'utf8'),
          mtime: new Date(),
        })),
      )
      // Belt and braces alongside the filter above: two users finishing the
      // same new topic at once would both pass the check, and the loser of
      // that race must not error or overwrite.
      .onConflictDoNothing({ target: [notes.vaultId, notes.path] })
  }
  res.json({ added: fresh.length, skipped: entries.length - fresh.length })
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
