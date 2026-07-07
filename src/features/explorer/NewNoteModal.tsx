import { useMemo, useState } from 'react'
import { useVault } from '../../vault/vaultStore'

// Matches the vault's Templates/Topic Note.md schema so new notes plug straight
// into the Automated Graph dashboards and AI Sync.
const topicTemplate = (title: string) => `---
space:
status: frontier
prerequisites: []
importance: 3
interest: 3
confidence: 0
last_reviewed:
---

# ${title}

## AI Notes


## Useful Links


## My Notes


## Questions

`

export function NewNoteModal({ onClose }: { onClose: () => void }) {
  const files = useVault((s) => s.files)
  const createNote = useVault((s) => s.createNote)

  const folders = useMemo(() => {
    const set = new Set<string>([''])
    for (const f of files) {
      const i = f.path.lastIndexOf('/')
      if (i <= 0) continue
      const parts = f.path.slice(0, i).split('/')
      let cur = ''
      for (const p of parts) {
        cur = cur ? `${cur}/${p}` : p
        set.add(cur)
      }
    }
    return [...set].sort()
  }, [files])

  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [useTemplate, setUseTemplate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    const clean = name.trim().replace(/\.md$/i, '')
    if (!clean || busy) return
    setBusy(true)
    setError(null)
    const path = folder ? `${folder}/${clean}` : clean
    try {
      await createNote(path, useTemplate ? topicTemplate(clean) : `# ${clean}\n\n`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal newnote-modal" onClick={(e) => e.stopPropagation()}>
        <div className="newnote-title">New note</div>
        <input
          autoFocus
          className="newnote-input"
          placeholder="Note name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
            if (e.key === 'Escape') onClose()
          }}
        />
        <label className="newnote-field">
          <span>Folder</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            {folders.map((f) => (
              <option key={f} value={f}>{f === '' ? '(vault root)' : f}</option>
            ))}
          </select>
        </label>
        <label className="newnote-check">
          <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
          Use topic template (frontmatter + AI Notes / My Notes / Questions sections)
        </label>
        {error && <div className="ask-error">{error}</div>}
        <div className="newnote-foot">
          <button className="ask-btn" onClick={onClose}>Cancel</button>
          <button className="ask-btn primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
