// The flashcards tab's half of /api/flashcards. The server owns the deck —
// which cards, which way round, and how many — so this only asks and renders.
import { localDay } from '../automated-graph/engine'

export interface Flashcard {
  notePath: string
  noteTitle: string
  term: string
  definition: string
  /** Which face the card opens on. Decided when the deck was dealt, so it
   *  is the same after a reload. */
  front: 'term' | 'definition'
}

export interface Deck {
  day: string
  cards: Flashcard[]
}

export interface DeckToday {
  deck: Deck | null
  /** Reviewed notes with enough prose to draw cards from. Null once a deck
   *  exists, because then it no longer matters. */
  notes: number | null
  /** How many cards a day this account gets. */
  limit: number
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  // The server's messages here are written to be read by the user.
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function fetchDeck(): Promise<DeckToday> {
  const res = await fetch(`/api/flashcards/today?day=${encodeURIComponent(localDay())}`, {
    credentials: 'include',
  })
  return (await jsonOrThrow(res)) as DeckToday
}

export async function dealDeck(): Promise<Deck> {
  const res = await fetch('/api/flashcards/today', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: localDay() }),
  })
  return ((await jsonOrThrow(res)) as { deck: Deck }).deck
}
