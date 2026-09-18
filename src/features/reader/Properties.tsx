import { useVault } from '../../vault/vaultStore'
import { ScoreSlider } from './ScoreSlider'
import './properties.css'

// The three frontmatter fields that feed the Next Up ranking, and the only
// ones the reader is expected to change from day to day. Everything else in
// frontmatter stays read-only here — it is structure, not a dial.
const SCORE_KEYS = new Set(['importance', 'interest', 'confidence'])

/** Frontmatter may carry these as numbers, numeric strings, or nothing at
 *  all for a note that declares the key but leaves it blank. */
function asScore(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(n)) return value == null || value === '' ? 0 : null
  return Math.min(5, Math.max(0, Math.round(n)))
}

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
  // js-yaml parses an unquoted YYYY-MM-DD into a Date, which would otherwise
  // fall through to String() and print "Thu Jun 11 2026 05:30:00 GMT+0530…".
  // Render it back as the plain date the file actually contains.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
      <span className="prop-pill">
        {value.getUTCFullYear()}-{pad(value.getUTCMonth() + 1)}-{pad(value.getUTCDate())}
      </span>
    )
  }
  if (value == null || value === '') return <span className="prop-empty">—</span>
  return <span className="prop-pill">{String(value)}</span>
}

export function Properties({
  frontmatter,
  notePath,
}: {
  frontmatter: Record<string, unknown>
  notePath: string
}) {
  const entries = Object.entries(frontmatter)
  if (entries.length === 0) return null
  return (
    <div className="properties">
      {entries.map(([key, value]) => {
        const score = SCORE_KEYS.has(key.toLowerCase()) ? asScore(value) : null
        return (
          <div className="prop-row" key={key}>
            <div className="prop-key">{key}</div>
            <div className="prop-val">
              {score === null ? (
                <PropValue value={value} />
              ) : (
                <ScoreSlider notePath={notePath} field={key} value={score} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
