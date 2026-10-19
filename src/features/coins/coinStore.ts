// Coins, as the client sees them (the rules live on the server, in
// backend/src/usage/coins.ts): earned for new notes and quizzes, spent on
// new collections.
//
// Like the streak, the client never decides what was earned: only the server
// knows whether a note was finished for the first time. After anything that
// might earn coins, `check()` asks — a few times, because the event that
// earns them can land just after the save returns — and when the balance has
// changed, the difference becomes an `award` for the animation to play —
// positive when earned, negative when a collection was paid for.
//
// `shown` is what the top bar displays. It trails `balance` during the
// animation, ticking one coin at a time as each lands, so the number moves
// when the coin arrives (or leaves) rather than before.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useVault } from '../../vault/vaultStore'
import { fromBootstrap } from '../../bootstrap'

export interface Coins {
  balance: number
  notes: number
  quizzes: number
  paidCollections: number
  nextCollectionCost: number
}

export interface Award {
  id: number
  /** Negative for a spend. */
  amount: number
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
  check: () => void
  /** One coin of the award has reached the badge (or left it). */
  landed: () => void
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

  check: () => {
    if (checking) return
    checking = true
    const before = get().coins?.balance ?? null
    void (async () => {
      try {
        for (const wait of [350, 800, 1600, 3000]) {
          await sleep(wait)
          const c = await fetchCoins()
          if (!c) continue
          if (before == null) {
            set({ coins: c, shown: c.balance })
            return
          }
          if (c.balance !== before) {
            set({ coins: c, award: { id: nextId++, amount: c.balance - before } })
            return
          }
        }
      } finally {
        checking = false
      }
    })()
  },

  landed: () =>
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
