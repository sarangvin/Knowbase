// Coins, as the client sees them (the rules live on the server, in
// backend/src/usage/coins.ts): earned for new notes and right quiz answers,
// spent on new collections.
//
// The client never decides what was earned: only the server knows whether a
// note was finished for the first time. After anything that might move the
// balance, `check()` asks — a few times, because the event behind it can
// land just after the save returns — or, where the server already sent the
// new balance back (a quiz answer), `apply()` takes it directly. Either way
// a change becomes an `award` for the animation to play: positive when
// earned, negative when spent, and optionally anchored to a point on screen
// (the answer that earned it, the button that spent it).
//
// `shown` is what the top bar displays. It trails `balance` while an award
// plays, so the number moves when the coin arrives (or leaves) rather than
// before.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useVault } from '../../vault/vaultStore'
import { fromBootstrap } from '../../bootstrap'

export interface Coins {
  balance: number
  notes: number
  correctAnswers: number
  paidCollections: number
  nextCollectionCost: number
}

export interface Point {
  x: number
  y: number
}

export interface Award {
  id: number
  /** Negative for a spend. */
  amount: number
  /** Where on screen it came from (or goes to); the middle if absent. */
  at?: Point
}

/** The middle of an element, for an award's `at`. */
export function centerOf(el: Element | null | undefined): Point | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return undefined
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

async function fetchCoins(): Promise<Coins | null> {
  try {
    const res = await fetch('/api/account/coins', { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as Coins
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Store {
  coins: Coins | null
  shown: number
  award: Award | null
  load: () => Promise<void>
  check: (at?: Point) => void
  apply: (c: Coins, at?: Point) => void
  /** Move the shown count one coin toward the balance. */
  step: () => void
  /** The award has finished playing. */
  settle: () => void
}

let checking = false
let nextId = 1

export const useCoins = create<Store>((set, get) => ({
  coins: null,
  shown: 0,
  award: null,

  load: async () => {
    const c = (await fromBootstrap<Coins>('coins')) ?? (await fetchCoins())
    if (!c) return
    // Coins earned elsewhere (another tab, another device) while away show
    // up quietly; the animation is for what was just done here.
    if (get().award) set({ coins: c })
    else set({ coins: c, shown: c.balance })
  },

  check: (at) => {
    if (checking) return
    checking = true
    const before = get().coins?.balance ?? null
    void (async () => {
      try {
        for (const wait of [300, 700, 1500, 3000]) {
          await sleep(wait)
          const c = await fetchCoins()
          if (!c) continue
          if (before == null || c.balance !== before) {
            get().apply(c, at)
            return
          }
        }
      } finally {
        checking = false
      }
    })()
  },

  apply: (c, at) => {
    const before = get().coins?.balance
    // Nothing to animate from, nothing changed, or an award already playing
    // (which snaps the count to the latest balance when it settles).
    if (before == null) set({ coins: c, shown: c.balance })
    else if (c.balance === before || get().award) set({ coins: c })
    else set({ coins: c, award: { id: nextId++, amount: c.balance - before, at } })
  },

  step: () =>
    set((s) => {
      const target = s.coins?.balance ?? s.shown
      return { shown: s.shown < target ? s.shown + 1 : s.shown > target ? s.shown - 1 : s.shown }
    }),

  settle: () => set((s) => ({ award: null, shown: s.coins?.balance ?? s.shown })),
}))

/** Loads the balance once there is a user, and again when the app comes
 *  back to the front. */
export function useCoinsBoot(): void {
  const user = useVault((s) => s.user)
  const load = useCoins((s) => s.load)
  useEffect(() => {
    if (!user) return
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user, load])
}
