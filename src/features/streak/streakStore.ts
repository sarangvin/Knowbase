// The daily streak, as the client sees it (the rules live on the server, in
// backend/src/usage/streak.ts).
//
// Two jobs. Keep the current count for the bare number in the top bar, and
// notice the moment today's goal is met so the streak card can play — that
// moment is the one worth marking, so it is detected here, once, rather than
// by each of the three screens that can cause it.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useVault } from '../../vault/vaultStore'
import { localDay } from '../automated-graph/engine'

export interface StreakDay {
  day: string
  state: 'done' | 'frozen' | 'none'
}

export interface StreakState {
  days: number
  todayDone: boolean
  freezes: number
  maxFreezes: number
  frozen: string[]
  week: StreakDay[]
  justGraduated: boolean
  graduationStreak: number
}

/** What the card shows: the count going from one number to the next. */
export interface Celebration {
  from: number
  to: number
  streak: StreakState
}

async function fetchStreak(): Promise<StreakState | null> {
  try {
    const res = await fetch(`/api/account/streak?day=${encodeURIComponent(localDay())}`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    return (await res.json()) as StreakState
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Store {
  streak: StreakState | null
  celebration: Celebration | null
  /** Set when a check made this account graduate, so the shell can refresh
   *  the user (and with it the limits it shows). */
  graduated: boolean
  load: () => Promise<void>
  goalAction: () => void
  dismiss: () => void
}

let checking = false

export const useStreak = create<Store>((set, get) => ({
  streak: null,
  celebration: null,
  graduated: false,

  load: async () => {
    const s = await fetchStreak()
    if (s) set({ streak: s, graduated: get().graduated || s.justGraduated })
  },

  /**
   * Call after anything that might have met today's goal: finishing a note,
   * turning the last card of the deck, answering the quiz's last question.
   *
   * It asks the server rather than deciding here, because only the server
   * knows whether a note was new to this reader. And it asks more than once:
   * finishing a note records its event just after the save returns, so the
   * first look can be a moment early.
   */
  goalAction: () => {
    const before = get().streak
    if (before?.todayDone || checking) return
    checking = true
    void (async () => {
      try {
        for (const wait of [400, 900, 1800]) {
          await sleep(wait)
          const s = await fetchStreak()
          if (!s) continue
          if (s.todayDone) {
            const from = before ? before.days : Math.max(0, s.days - 1)
            set({
              streak: s,
              celebration: { from, to: s.days, streak: s },
              graduated: get().graduated || s.justGraduated,
            })
            return
          }
          set({ streak: s })
        }
      } finally {
        checking = false
      }
    })()
  },

  dismiss: () => set({ celebration: null }),
}))

/** Fetches the streak once there is a user, and refreshes the user when a
 *  check graduates them, so the limits shown elsewhere catch up. */
export function useStreakBoot(): void {
  const user = useVault((s) => s.user)
  const checkAuth = useVault((s) => s.checkAuth)
  const load = useStreak((s) => s.load)
  const graduated = useStreak((s) => s.graduated)
  useEffect(() => {
    if (user) void load()
  }, [user, load])
  useEffect(() => {
    if (graduated) void checkAuth()
  }, [graduated, checkAuth])
}
