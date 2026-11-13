// `/?note=<path>&from=email_next` — the links in the onboarding emails.
//
// Read once at boot and kept in sessionStorage, because a reader who is
// signed out goes through Google first and comes back to a bare `/`. The
// note is opened as soon as their own vault is loaded and has it.
import { pixel } from './pixel'
import { useVault } from './vault/vaultStore'

const KEY = 'rabbithole.deepLink'
const READ_KEY = 'rabbithole.read'

export function captureDeepLink(): void {
  try {
    const q = new URLSearchParams(location.search)
    const note = q.get('note')
    const from = q.get('from')
    const read = q.get('read')
    if (read) sessionStorage.setItem(READ_KEY, read)
    if (from === 'email_ready') pixel('email_click_ready')
    if (from === 'email_next') pixel('email_click_next')
    if (note) sessionStorage.setItem(KEY, note)
    if (note || from || read) {
      q.delete('note')
      q.delete('from')
      q.delete('read')
      const rest = q.toString()
      history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : ''))
    }
  } catch {
    // Storage blocked: the link still opens the app, just not that note.
  }
}

/** Open the captured note if the loaded vault has it. True if it did. */
export function openDeepLink(): boolean {
  let path: string | null = null
  try {
    path = sessionStorage.getItem(KEY)
  } catch {
    return false
  }
  if (!path) return false
  const { getNote, openView } = useVault.getState()
  if (!getNote(path)) return false
  sessionStorage.removeItem(KEY)
  openView({ kind: 'note', path })
  return true
}

/** `/?read=<Collection>`: a library collection to preview signed out. */
export function readLink(): string | null {
  try {
    return sessionStorage.getItem(READ_KEY)
  } catch {
    return null
  }
}

export function clearReadLink(): void {
  try {
    sessionStorage.removeItem(READ_KEY)
  } catch {
    // nothing to clear
  }
}

const PREVIEWED_KEY = 'rabbithole.previewed'

/** The note they read in the preview before signing up, so landing in their
 *  new collection does not hand them the same note again. */
export function markPreviewed(title: string): void {
  try {
    sessionStorage.setItem(PREVIEWED_KEY, title)
  } catch {
    // they may see it twice; nothing worse
  }
}

export function previewedTitle(): string | null {
  try {
    return sessionStorage.getItem(PREVIEWED_KEY)
  } catch {
    return null
  }
}
