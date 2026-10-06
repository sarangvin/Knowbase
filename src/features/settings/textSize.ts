// Text size: five steps, the default in the middle.
//
// Applied as a zoom on the whole app rather than as a font-size, because the
// stylesheets size text in px throughout (there are ~200 declarations), so a
// root font-size would change nothing. Zoom scales the text and the spacing
// around it together, which is also what keeps a larger size readable rather
// than cramped — the same thing a browser's own zoom does, but kept for this
// app and on phones, where there is no browser zoom to reach for.
//
// Per device, in localStorage: the right size for a phone is not the right
// size for a laptop. Wrapped, like every storage access here: a blocked
// store means the default size, not an error.
export const TEXT_SIZES = [
  { id: 'xs', label: 'Smallest', zoom: 0.875 },
  { id: 's', label: 'Small', zoom: 0.9375 },
  { id: 'm', label: 'Default', zoom: 1 },
  { id: 'l', label: 'Large', zoom: 1.125 },
  { id: 'xl', label: 'Largest', zoom: 1.25 },
] as const

export type TextSizeId = (typeof TEXT_SIZES)[number]['id']

const KEY = 'kb:text-size'
export const DEFAULT_TEXT_SIZE: TextSizeId = 'm'

export function readTextSize(): TextSizeId {
  try {
    const v = localStorage.getItem(KEY)
    return TEXT_SIZES.some((s) => s.id === v) ? (v as TextSizeId) : DEFAULT_TEXT_SIZE
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

/** Sets the zoom the stylesheet reads (`--ui-zoom`, see index.css). */
export function applyTextSize(id: TextSizeId): void {
  const zoom = TEXT_SIZES.find((s) => s.id === id)?.zoom ?? 1
  document.documentElement.style.setProperty('--ui-zoom', String(zoom))
}

export function setTextSize(id: TextSizeId): void {
  applyTextSize(id)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Applied for this visit; it just will not be remembered.
  }
}
