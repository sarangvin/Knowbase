// Picking up a new deploy without being asked to.
//
// The app is a single page, and once it is on a phone's home screen the
// phone keeps it alive in the background for days: coming back to it resumes
// the page already in memory, with whatever build it was opened on. A fix
// that is live on the server never reaches someone who just keeps switching
// back to the app.
//
// So whenever the app comes back to the front, it asks the server which
// build is current (the hashed entry script in index.html) and, if that is
// not the one running, reloads — the moment someone returns is the moment a
// reload costs them nothing. Except while something could be lost: a note
// being edited, or a text box with something in it. Then it waits for the
// next return.
//
// Only in a built app: the dev server has no hashed entry to compare.

const ENTRY = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+\.js)"/

function runningEntry(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
  return s ? new URL(s.src, location.href).pathname : null
}

/** Somewhere a reload would throw away what someone is typing. */
function busyTyping(): boolean {
  if (document.querySelector('.cm-editor, [contenteditable="true"]')) return true
  return [...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"], input:not([type])')].some(
    (el) => el.value.trim() !== '',
  )
}

let checking = false

async function checkForNewBuild(): Promise<void> {
  const running = runningEntry()
  if (!running || checking) return
  checking = true
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return
    const latest = (await res.text()).match(ENTRY)?.[1]
    if (!latest || new URL(latest, location.href).pathname === running) return
    if (busyTyping()) return
    location.reload()
  } catch {
    // Offline or mid-deploy: the next return asks again.
  } finally {
    checking = false
  }
}

export function installUpdateCheck(): void {
  if (import.meta.env.DEV) return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewBuild()
  })
  // Installed apps also resume through pageshow (the back-forward cache).
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void checkForNewBuild()
  })
}
