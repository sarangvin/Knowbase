// Copies the KnowBase Obsidian vault into public/vault/ and emits a manifest.json
// the app fetches on boot. This bundled vault is the "demo" source; users can also
// open their own folder via the File System Access API at runtime.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
// Vault content lives in "KnowBase/Knowledge Base" (sibling of this project).
const VAULT_SRC = path.resolve(ROOT, '..', 'KnowBase', 'Knowledge Base')
const OUT_DIR = path.resolve(ROOT, 'public', 'vault')

const MD_EXT = new Set(['.md'])
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.base'])
const IGNORE = new Set(['.obsidian', '.git', '.DS_Store', '.trash'])

async function walk(dir, base = '') {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith('._')) continue
    const abs = path.join(dir, e.name)
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) {
      out.push(...(await walk(abs, rel)))
    } else {
      const ext = path.extname(e.name).toLowerCase()
      if (MD_EXT.has(ext) || ASSET_EXT.has(ext)) {
        out.push({ rel, abs, ext })
      }
    }
  }
  return out
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(OUT_DIR, { recursive: true })
  const files = await walk(VAULT_SRC)

  const manifest = []
  for (const f of files) {
    const dest = path.join(OUT_DIR, f.rel)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(f.abs, dest)
    const stat = await fs.stat(f.abs)
    manifest.push({
      path: f.rel,
      type: MD_EXT.has(f.ext) ? 'note' : 'asset',
      ext: f.ext.slice(1),
      size: stat.size,
      mtime: stat.mtimeMs,
    })
  }

  manifest.sort((a, b) => a.path.localeCompare(b.path))
  await fs.writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ name: 'KnowBase', generatedAt: 0, files: manifest }, null, 2),
  )
  const notes = manifest.filter((m) => m.type === 'note').length
  const assets = manifest.filter((m) => m.type === 'asset').length
  console.log(`Bundled vault: ${notes} notes, ${assets} assets -> ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
