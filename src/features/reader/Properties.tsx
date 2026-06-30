import { useVault } from '../../vault/vaultStore'
import './properties.css'

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/

function PropValue({ value }: { value: unknown }) {
  const openNote = useVault((s) => s.openNote)
  const resolveLink = useVault((s) => s.resolveLink)

  if (Array.isArray(value)) {
    return (
      <div className="prop-array">
        {value.map((v, i) => (
          <PropValue key={i} value={v} />
        ))}
      </div>
    )
  }
  if (typeof value === 'string') {
    const m = value.match(WIKILINK_RE)
    if (m) {
      const target = m[1].split('|')[0].split('#')[0].trim()
      const path = resolveLink(target)
      return (
        <a
          className={path ? 'prop-pill internal-link' : 'prop-pill internal-link is-unresolved'}
          onClick={() => path && openNote(path)}
        >
          {target}
        </a>
      )
    }
    return <span className="prop-pill">{value}</span>
  }
  if (typeof value === 'boolean') return <span className="prop-pill">{value ? 'true' : 'false'}</span>
  if (value == null || value === '') return <span className="prop-empty">—</span>
  return <span className="prop-pill">{String(value)}</span>
}

export function Properties({ frontmatter }: { frontmatter: Record<string, unknown> }) {
  const entries = Object.entries(frontmatter)
  if (entries.length === 0) return null
  return (
    <div className="properties">
      {entries.map(([key, value]) => (
        <div className="prop-row" key={key}>
          <div className="prop-key">{key}</div>
          <div className="prop-val">
            <PropValue value={value} />
          </div>
        </div>
      ))}
    </div>
  )
}
