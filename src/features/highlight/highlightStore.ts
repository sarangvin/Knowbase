// Highlight mode: tap the highlighter, select words in the note, tap it again
// and those words become a link to a new note on them (the server half is
// backend/src/notes/highlight.ts).
//
// The selection is captured as it is made rather than read when the button
// is tapped the second time: on a phone, tapping a button can clear the
// selection before the tap handler runs.
import { create } from 'zustand'
import { useVault } from '../../vault/vaultStore'
import { announceServerWork } from '../onboarding/onboardingApi'

interface Result {
  title: string
  path: string
  created: boolean
  remaining: number
}

interface Store {
  active: boolean
  busy: boolean
  /** The words selected in the note while active. */
  selection: string
  message: string | null
  /** The link just made, so the bar can offer to open it. */
  made: Result | null
  /** Set when the day's allowance is spent on a free account. */
  upsell: boolean
  toggle: (notePath: string) => void
  capture: (text: string) => void
  dismiss: () => void
}

export const useHighlight = create<Store>((set, get) => ({
  active: false,
  busy: false,
  selection: '',
  message: null,
  made: null,
  upsell: false,

  toggle: (notePath) => {
    const { active, busy, selection } = get()
    if (busy) return
    if (!active) {
      window.getSelection()?.removeAllRanges()
      set({ active: true, selection: '', message: null, made: null, upsell: false })
      return
    }
    const text = selection.replace(/\s+/g, ' ').trim()
    // Second tap with nothing selected: the reader changed their mind.
    if (!text) {
      set({ active: false, message: null })
      return
    }
    set({ busy: true, message: null })
    void (async () => {
      try {
        const res = await fetch('/api/notes/highlight', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: notePath, text }),
        })
        const data = (await res.json().catch(() => ({}))) as Partial<Result> & { error?: string; upgrade?: string }
        if (!res.ok) {
          set({ busy: false, message: data.error ?? `Could not make the link (${res.status})`, upsell: data.upgrade === 'pro' })
          return
        }
        window.getSelection()?.removeAllRanges()
        // The note now has the link in it, and a new note exists to draft.
        await useVault.getState().refreshVault()
        if (data.created) announceServerWork()
        set({ busy: false, active: false, selection: '', made: data as Result, message: null })
      } catch (e) {
        set({ busy: false, message: e instanceof Error ? e.message : String(e) })
      }
    })()
  },

  capture: (text) => set({ selection: text }),
  dismiss: () => set({ active: false, busy: false, selection: '', message: null, made: null, upsell: false }),
}))
