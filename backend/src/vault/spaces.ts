// Vault/space primitives shared by the routes that read or write generated
// spaces. These all began as module-private helpers in routes/vaults.ts and
// moved here when the onboarding pipeline needed the same answers: which vault
// is this user's, which space does a path belong to, and do two topic strings
// mean the same thing. Two copies of the last one in particular would be a
// real bug — the corpus lookup and the corpus write have to agree on the key.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, vaults } from '../db/schema.js'

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

/** Add freshly generated notes to the corpus. Insert-only: an existing note —
 *  including anything the owner has curated — is never modified. Returns how
 *  many were actually added.
 *
 *  Shared by POST /api/vaults/library/contribute (which validates untrusted
 *  client input first) and the onboarding pipeline, which contributes what it
 *  just generated. Contributing is always a side benefit: callers treat a
 *  failure here as nothing to report, since the user's own notes are already
 *  saved by the time this runs. */
export async function contributeToLibrary(entries: { path: string; content: string }[]): Promise<number> {
  const globalVaultId = await getGlobalVaultId()
  if (!globalVaultId) return 0

  const before = new Set(
    (await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, globalVaultId))).map((r) => r.path),
  )
  const fresh = entries.filter((e) => !before.has(e.path))
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
