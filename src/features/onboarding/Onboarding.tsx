import { useVault } from '../../vault/vaultStore'
import { FsAccessVaultSource } from '../../vault/source'
import { GraduationCap, Folder, Eye } from '../../ui/icons'
import './onboarding.css'

export function Onboarding() {
  const status = useVault((s) => s.status)
  const error = useVault((s) => s.error)
  const loadSeed = useVault((s) => s.loadSeed)
  const pickFolder = useVault((s) => s.pickFolder)
  const fsSupported = FsAccessVaultSource.isSupported()

  if (status === 'loading') {
    return (
      <div className="onboarding">
        <div className="spinner" />
        <p className="ob-sub">Indexing vault…</p>
      </div>
    )
  }

  return (
    <div className="onboarding">
      <div className="ob-card">
        <div className="ob-logo">
          <GraduationCap width={34} height={34} />
        </div>
        <h1 className="ob-title">KnowBase</h1>
        <p className="ob-sub">
          A local-first knowledge base. Browse the linked graph, follow backlinks, and learn what
          to study next — all in your browser.
        </p>

        {error && <div className="ob-error">{error}</div>}

        <div className="ob-actions">
          <button className="ob-btn primary" onClick={() => void loadSeed()}>
            <Eye /> Explore the demo vault
          </button>
          {fsSupported ? (
            <button className="ob-btn" onClick={() => void pickFolder()}>
              <Folder /> Open my own folder
            </button>
          ) : (
            <div className="ob-note">
              Tip: open in Chrome or Edge to load your own folder with read/write access.
            </div>
          )}
        </div>
        <p className="ob-fineprint">
          Your notes never leave your device. Demo edits save in this browser; your own folder
          writes to disk.
        </p>
      </div>
    </div>
  )
}
