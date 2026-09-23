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
import { notes } from '../db/schema.js'
import { requireAuth, requireApproved, requireOwner } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { validateVaultPath, PathError } from '../vault/pathValidation.js'
import { logUsageEvent } from '../usage/logEvent.js'
import { NOT_HIDDEN } from '../vault/hidden.js'
import { SPACE_ROOT, spaceOf, normalizeTopic, getOrCreatePersonalVaultId, getGlobalVaultId, adoptSpaceInto, contributeToLibrary, archivedSpaces, setSpaceArchived, deleteSpace } from '../vault/spaces.js'

export const vaultsRouter = Router()
vaultsRouter.use(requireAuth)
// Cloud vaults are the owner's storage, so they're behind owner approval.
// The demo vault and "open my own folder" are pure client-side and never
// reach this router, which is what an unapproved user is left with.
vaultsRouter.use(requireApproved)

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

  // Hidden notes are excluded here rather than filtered in the client.
  // A note the browser receives and agrees not to draw is one search box,
  // one graph view or one export away from being drawn, and the buffer only
  // works if the reader genuinely cannot see what is in it.
  const personalRows = await db
    .select({ path: notes.path, sizeBytes: notes.sizeBytes, mtime: notes.mtime })
    .from(notes)
    .where(and(eq(notes.vaultId, personalVaultId), NOT_HIDDEN))

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
  //
  // Not logged when the client says this is its periodic background sync.
  // That runs about once a minute per open tab, and counting it as a vault
  // sync would turn a figure that means "somebody opened their vault" into
  // a count of how long a tab was left open.
  if (!req.query.background) void logUsageEvent({ userId: req.user!.id, eventType: 'vault_sync' })
}))

vaultsRouter.get('/mine/note', asyncHandler(async (req, res) => {
  const parsed = parsePathParam(req.query.path)
  if (typeof parsed !== 'string') {
    res.status(400).json(parsed)
    return
  }
  const path = parsed

  const personalVaultId = await getOrCreatePersonalVaultId(req.user!.id)
  // NOT_HIDDEN here as well as in the listing. The listing is what an honest
  // client works from, but the path is a query parameter and guessing a
  // plausible topic filename is not hard; a buffer that leaks to anyone who
  // types the right URL is not a buffer.
  const personal = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, personalVaultId), eq(notes.path, path), NOT_HIDDEN))
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

/** A collection's name, as a single path segment. Never a path: a slash or
 *  a traversal here would let one request reach outside the space it names. */
function spaceParam(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > 80 || s.includes('/') || s.includes('\\') || s.startsWith('.')) return null
  return s
}

/** Which of this vault's collections are archived. The client reads the flag
 *  from `_config.md` in the index it already holds; this is for Settings,
 *  which wants the list without caring where it came from. */
vaultsRouter.get('/mine/spaces/archived', asyncHandler(async (req, res) => {
  const vaultId = await getOrCreatePersonalVaultId(req.user!.id)
  res.json({ archived: [...(await archivedSpaces(vaultId))].sort() })
}))

/** Archive a collection, or bring it back.
 *
 *  Archiving writes `archived: true` into the space's own `_config.md` —
 *  nothing is deleted and nothing moves. The collection drops out of the
 *  home screen and stops feeding quizzes and flashcards; every note stays
 *  exactly where it was, which is the whole difference from delete. */
vaultsRouter.post('/mine/space/archive', asyncHandler(async (req, res) => {
  const space = spaceParam(req.body?.space)
  const archived = req.body?.archived
  if (!space || typeof archived !== 'boolean') {
    res.status(400).json({ error: 'body.space and body.archived (boolean) required' })
    return
  }
  const vaultId = await getOrCreatePersonalVaultId(req.user!.id)
  if (!(await setSpaceArchived(vaultId, space, archived))) {
    res.status(404).json({ error: 'No such collection.' })
    return
  }
  res.json({ space, archived })
  void logUsageEvent({
    userId: req.user!.id,
    eventType: 'vault_sync',
    metadata: { vault: 'personal', space, archived },
  })
}))

/** Delete a collection from this user's vault.
 *
 *  Scoped to their personal vault and nothing else. The global corpus keeps
 *  its copy, so the subject can still be adopted instantly by the next
 *  person who asks for it — including this one, if they change their mind.
 *  Deleting your own notes is not a request to un-write the topic for
 *  everybody. */
vaultsRouter.delete('/mine/space', asyncHandler(async (req, res) => {
  const space = spaceParam(req.query.space)
  if (!space) {
    res.status(400).json({ error: 'space (a single collection name) required' })
    return
  }
  const userId = req.user!.id
  const vaultId = await getOrCreatePersonalVaultId(userId)
  const result = await deleteSpace(vaultId, userId, space)
  if (result.deletedNotes === 0) {
    res.status(404).json({ error: 'No such collection.' })
    return
  }
  res.json(result)
  void logUsageEvent({
    userId,
    eventType: 'vault_sync',
    metadata: { vault: 'personal', space, deleted: result.deletedNotes, source: 'delete-space' },
  })
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

  const personalVaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const result = await adoptSpaceInto(personalVaultId, space)
  if (!result.ok) {
    res.status(404).json({
      error: result.reason === 'no-library' ? 'nothing in the library yet' : 'no such space in the library',
    })
    return
  }

  res.json({ adopted: result.adopted, skipped: result.skipped, openPath: result.openPath })
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

  // Returns 0 when the corpus doesn't exist yet, which is not an error the
  // user caused or can fix — their own notes are already saved either way.
  const added = await contributeToLibrary(entries)
  res.json({ added, skipped: entries.length - added })
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
