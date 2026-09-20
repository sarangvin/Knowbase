// Carries the topic a visitor typed on the landing screen across the Google
// OAuth round-trip, so the first thing we ask is the product's own question
// rather than "which storage backend do you want".
//
// localStorage, not a URL parameter: the topic survives the full-page
// redirect to accounts.google.com and back, and keeping it out of the query
// string keeps it out of server logs and Referer headers. It's low-stakes
// text, but it's the user's own words and there's no reason to publish it.
//
// Every access is wrapped: localStorage throws outright in some privacy
// modes, and a topic handoff failing must never break sign-in. Losing the
// topic costs one retype; an uncaught exception here costs the session.
const KEY = 'rabbithole-pending-topic'

/** Discard a stale handoff — someone who signed in, wandered off, and came
 * back days later should not be ambushed by a topic they've forgotten
 * typing. Long enough to survive a slow OAuth round-trip and a detour
 * through account selection. */
const MAX_AGE_MS = 30 * 60 * 1000

export function setPendingTopic(topic: string): void {
  const trimmed = topic.trim()
  if (!trimmed) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ topic: trimmed, at: Date.now() }))
  } catch {
    /* private mode / storage disabled — the user retypes, nothing breaks */
  }
}

/** Read without consuming, for pre-filling the landing screen's input.
 *
 *  The handoff used to be take-only, which meant that whenever the automatic
 *  start did not fire — an unapproved account, most obviously — the topic sat
 *  in storage unread while the user stared at an empty box and typed it
 *  again. Being able to look without consuming is what makes "you only ever
 *  type it once" true on every path rather than the happy one. */
export function peekPendingTopic(): string | null {
  return readPendingTopic(false)
}

/** Reads and clears in one step: a pending topic is consumed exactly once,
 * so a failed generation doesn't silently re-trigger on the next render. */
export function takePendingTopic(): string | null {
  return readPendingTopic(true)
}

function readPendingTopic(consume: boolean): string | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
    if (consume) localStorage.removeItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const { topic, at } = JSON.parse(raw) as { topic?: unknown; at?: unknown }
    if (typeof topic !== 'string' || typeof at !== 'number') return null
    if (Date.now() - at > MAX_AGE_MS) return null
    return topic || null
  } catch {
    return null
  }
}

export function clearPendingTopic(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}
