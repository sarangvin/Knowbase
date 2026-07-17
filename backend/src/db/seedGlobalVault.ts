// One-time (idempotent) seed of the global vault from the already-built
// public/vault/ output — i.e. the denylist-filtered, human-reviewed demo
// vault that ships today, NOT a live re-walk of the private source vault.
// Per the plan's Context note: once this content is served to every signed-up
// stranger rather than a personal GitHub Pages repo, curate future additions
// by allowlist (deliberately add what's public) rather than denylist
// (exclude what isn't) — the blast radius of a missed exclusion is now real.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { db, pool } from './client.js'
import { vaults, notes, assets } from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// backend/src/db/ -> backend -> knowbase-web -> public/vault
const VAULT_DIR = path.resolve(__dirname, '..', '..', '..', 'public', 'vault')

interface ManifestFile {
  path: string
  type: 'note' | 'asset'
  ext: string
  size: number
  mtime: number
}
interface Manifest {
  name?: string
  files: ManifestFile[]
}

async function getOrCreateGlobalVaultId(name: string): Promise<string> {
  const existing = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.kind, 'global')).limit(1)
  if (existing[0]) return existing[0].id
  const [row] = await db.insert(vaults).values({ ownerUserId: null, kind: 'global', name }).returning({ id: vaults.id })
  return row.id
}

async function main() {
  const manifestRaw = await fs.readFile(path.join(VAULT_DIR, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestRaw) as Manifest

  const vaultId = await getOrCreateGlobalVaultId(manifest.name ?? 'Global Vault')

  let noteCount = 0
  let assetCount = 0
  for (const f of manifest.files) {
    if (f.type === 'note') {
      const content = await fs.readFile(path.join(VAULT_DIR, f.path), 'utf8')
      await db
        .insert(notes)
        .values({ vaultId, path: f.path, content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date(f.mtime) })
        .onConflictDoUpdate({
          target: [notes.vaultId, notes.path],
          set: { content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date(f.mtime) },
        })
      noteCount++
    } else {
      // Metadata only — binary storage (S3-backed storageKey) isn't wired up
      // yet, matching the M1 limitation in routes/vaults.ts. Images/PDFs in
      // the seeded global vault won't render until that lands.
      const storageKey = `${vaultId}/${f.path}` // placeholder until real S3 keys are derived (sha256 of path, per plan)
      await db
        .insert(assets)
        .values({ vaultId, path: f.path, contentType: `application/octet-stream`, sizeBytes: f.size, storageKey })
        .onConflictDoUpdate({ target: [assets.vaultId, assets.path], set: { sizeBytes: f.size } })
      assetCount++
    }
  }

  // Remove global notes/assets no longer present in the current manifest, so
  // re-running the seed after editing public/vault/ reflects deletions too.
  const currentPaths = new Set(manifest.files.map((f) => f.path))
  const existingNotes = await db.select({ path: notes.path }).from(notes).where(eq(notes.vaultId, vaultId))
  for (const row of existingNotes) {
    if (!currentPaths.has(row.path)) {
      await db.delete(notes).where(and(eq(notes.vaultId, vaultId), eq(notes.path, row.path)))
    }
  }

  console.log(`Seeded global vault ${vaultId}: ${noteCount} notes, ${assetCount} asset entries (metadata only).`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
