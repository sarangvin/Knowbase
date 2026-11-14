// Light or dark, per device (like text size). "System" follows the
// operating system and changes with it. Applied by setting data-theme on
// <html>, which index.css turns into the light or dark tokens.
export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const KEY = 'kb:theme'
/** Dark stays the default: it is what the app was designed in. */
export const DEFAULT_THEME: ThemeId = 'dark'

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

let unwatch: (() => void) | null = null

export function applyTheme(id: ThemeId): void {
  unwatch?.()
  unwatch = null
  const root = document.documentElement
  if (id !== 'system') {
    root.dataset.theme = id
    return
  }
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const set = () => (root.dataset.theme = mq.matches ? 'light' : 'dark')
  set()
  mq.addEventListener('change', set)
  unwatch = () => mq.removeEventListener('change', set)
}

export function setTheme(id: ThemeId): void {
  applyTheme(id)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Applies for this visit; just not remembered.
  }
}
