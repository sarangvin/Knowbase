// Vault/space primitives shared by the routes that read or write generated
// spaces. These all began as module-private helpers in routes/vaults.ts and
// moved here when the onboarding pipeline needed the same answers: which vault
// is this user's, which space does a path belong to, and do two topic strings
// mean the same thing. Two copies of the last one in particular would be a
// real bug — the corpus lookup and the corpus write have to agree on the key.
import { and, eq, like, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, vaults, draftQueue, flashcardReviews } from '../db/schema.js'
import { frontmatterValue, setFrontmatterValue } from './frontmatter.js'

export const SPACE_ROOT = 'Automated Graph/'

/** "Automated Graph/Economics/Topics/x.md" -> "Economics". Null for anything
 * outside that layout, which the corpus doesn't describe. */
export function spaceOf(path: string): string | null {
  if (!path.startsWith(SPACE_ROOT)) return null
  const rest = path.slice(SPACE_ROOT.length)
  const slash = rest.indexOf('/')
  return slash > 0 ? rest.slice(0, slash) : null
}

/** Match key for "do we already have this topic?". Deliberately conservative:
 * case and punctuation are noise, but anything cleverer (stemming, embeddings)
 * risks handing someone a space about a different subject, which is far worse
 * than regenerating one. */
export function normalizeTopic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** vault_id is always derived from the session — never accepted from the client. */
export async function getOrCreatePersonalVaultId(userId: string): Promise<string> {
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
export async function getGlobalVaultId(): Promise<string | null> {
  const existing = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.kind, 'global')).limit(1)
  return existing[0]?.id ?? null
}

/** Every space name the user already has, for collision-avoiding naming. */
export async function listUserSpaces(personalVaultId: string): Promise<string[]> {
  const rows = await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, personalVaultId))
  const names = new Set<string>()
  for (const r of rows) {
    const s = spaceOf(r.path)
    if (s) names.add(s)
  }
  return [...names]
}

export type AdoptResult =
  | { ok: true; adopted: number; skipped: number; openPath: string }
  | { ok: false; reason: 'no-library' | 'no-space' }

/** Copy one corpus space into a personal vault. Paths the user already has are
 *  skipped, never overwritten — adopting must not clobber work.
 *
 *  Shared by POST /api/vaults/mine/adopt and the onboarding pipeline, which
 *  tries the corpus before it spends six model calls. */
export async function adoptSpaceInto(personalVaultId: string, space: string): Promise<AdoptResult> {
  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) return { ok: false, reason: 'no-library' }

  const source = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(eq(notes.vaultId, globalVaultId))
  const wanted = source.filter((r) => spaceOf(r.path) === space)
  if (wanted.length === 0) return { ok: false, reason: 'no-space' }

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

  return {
    ok: true,
    adopted: toInsert.length,
    skipped: wanted.length - toInsert.length,
    openPath: `${SPACE_ROOT}${space}/Next Up.md`,
  }
}

/** The corpus space matching this topic, or null. Name-key equality only —
 *  see normalizeTopic on why this stays dumb. */
export async function findLibrarySpaceFor(topic: string): Promise<string | null> {
  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) return null
  const rows = await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, globalVaultId))
  const key = normalizeTopic(topic)
  for (const r of rows) {
    const s = spaceOf(r.path)
    if (s && normalizeTopic(s) === key) return s
  }
  return null
}

/** Empty out any section of a note that belongs to its author.
 *
 *  The heading stays — an adopted note should still have somewhere to write
 *  — but whatever was under it does not travel. Matched on the heading and
 *  the next heading, the same shape the client's own section helper uses.
 */
export function withoutPrivateSections(content: string): string {
  return content.replace(
    /(^|\n)(##\s+My Notes[^\n]*\n)[\s\S]*?(?=\n##\s|$)/i,
    (_m, lead: string, heading: string) => `${lead}${heading}`,
  )
}

/** Add freshly generated notes to the corpus. Insert-only: an existing note —
 *  including anything the owner has curated — is never modified. Returns how
 *  many were actually added.
 *
 *  Shared by POST /api/vaults/library/contribute (which validates untrusted
 *  client input first) and the onboarding pipeline, which contributes what it
 *  just generated. Contributing is always a side benefit: callers treat a
 *  failure here as nothing to report, since the user's own notes are already
 *  saved by the time this runs.
 *
 *  **`## My Notes` is stripped on the way in.** That section is the one part
 *  of a note the user writes, and the corpus is read by strangers. It used
 *  to be safe by circumstance — the only callers passed content captured
 *  before anyone could edit it, and the route's comment said so. That is an
 *  argument about callers, not a property of the corpus, and it stopped
 *  being true the moment My Notes became a box people type into. Enforced
 *  here because this is the single door into the global vault. */
export async function contributeToLibrary(entries: { path: string; content: string }[]): Promise<number> {
  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) return 0

  const before = new Set(
    (await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, globalVaultId))).map((r) => r.path),
  )
  const fresh = entries
    .filter((e) => !before.has(e.path))
    .map((e) => ({ path: e.path, content: withoutPrivateSections(e.content) }))
  if (fresh.length === 0) return 0

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
  return fresh.length
}

// ─── Archiving and deleting a collection ─────────────────────────────────────
//
// "Archived" is a line in the space's own `_config.md`, not a row in a table.
// The vault is the source of truth everywhere else in this app, and a flag
// kept beside the notes travels with an export, survives a database reset,
// and is readable by the client from the index it already holds — no second
// fetch and no second copy to drift. The cost is that a space with no
// _config.md needs one written, which is a two-line note.

function configPath(space: string): string {
  return `${SPACE_ROOT}${space}/_config.md`
}

/** A minimal config for a space that never had one. Only the flag: every
 *  other setting has a default in the reader, and writing them out here
 *  would freeze today's defaults into every archived space. */
function newConfig(space: string, archived: boolean): string {
  return `---\narchived: ${archived}\n---\n\n# ${space} — settings\n`
}

/** Which of this vault's spaces are archived.
 *
 *  One query for the whole vault rather than one per space: every caller —
 *  the quiz builder, the flashcard builder, growth — wants the set, and they
 *  want it before they know which spaces they care about. */
export async function archivedSpaces(vaultId: string): Promise<Set<string>> {
  const rows = await db
    .select({ path: notes.path, content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${SPACE_ROOT}%/_config.md`)))

  const out = new Set<string>()
  for (const r of rows) {
    const space = spaceOf(r.path)
    if (space && /^true$/i.test(frontmatterValue(r.content, 'archived') ?? '')) out.add(space)
  }
  return out
}

/** Set or clear the flag, creating `_config.md` if the space has none.
 *  Returns false when there is no such space, so a caller can 404 rather
 *  than silently create a config for a typo. */
export async function setSpaceArchived(vaultId: string, space: string, archived: boolean): Promise<boolean> {
  const prefix = `${SPACE_ROOT}${space}/`
  const [any] = await db
    .select({ path: notes.path })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${prefix}%`)))
    .limit(1)
  if (!any) return false

  const path = configPath(space)
  const [existing] = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.vaultId, vaultId), eq(notes.path, path)))
    .limit(1)

  const content = existing
    ? setFrontmatterValue(existing.content, 'archived', String(archived))
    : newConfig(space, archived)

  await db
    .insert(notes)
    .values({ vaultId, path, content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
    .onConflictDoUpdate({
      target: [notes.vaultId, notes.path],
      set: { content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() },
    })
  return true
}

export interface DeleteSpaceResult {
  deletedNotes: number
  cancelledJobs: number
  forgottenCards: number
}

/**
 * Delete a collection from one personal vault.
 *
 * **The global corpus is untouched.** Everything here is scoped to the vault
 * id it is given, and that is always the caller's own personal vault — the
 * library keeps its copy, so the topic can still be adopted instantly by the
 * next person who asks for it, including this one. Deleting your notes is
 * not a request to un-write the subject for everybody.
 *
 * The queue rows and flashcard schedules go with the notes. Leaving them is
 * how you get a draft job writing a note back into a space the user deleted,
 * and a spaced-repetition row for a card that no longer exists.
 */
export async function deleteSpace(vaultId: string, userId: string, space: string): Promise<DeleteSpaceResult> {
  const prefix = `${SPACE_ROOT}${space}/`

  const gone = await db
    .delete(notes)
    .where(and(eq(notes.vaultId, vaultId), like(notes.path, `${prefix}%`)))
    .returning({ path: notes.path })

  const jobs = await db
    .delete(draftQueue)
    .where(and(eq(draftQueue.vaultId, vaultId), like(draftQueue.path, `${prefix}%`)))
    .returning({ id: draftQueue.id })

  const cards = await db
    .delete(flashcardReviews)
    .where(and(eq(flashcardReviews.userId, userId), sql`${flashcardReviews.notePath} LIKE ${prefix + '%'}`))
    .returning({ id: flashcardReviews.id })

  return { deletedNotes: gone.length, cancelledJobs: jobs.length, forgottenCards: cards.length }
}
