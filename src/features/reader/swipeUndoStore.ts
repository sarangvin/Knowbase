// The few seconds after a swipe in which it can be taken back.
//
// A swipe saves at once and moves straight on to the next note, so a mistaken
// one leaves nothing on screen to fix it with. This holds what is needed to put
// the note back, along with whatever would be awkward to walk back once it has
// happened: a streak celebration, a coin award, and growing the collection from
// an interest vote the reader did not mean. Those wait in `commit` until the
// window closes.
//
// If the app is closed during the window, `commit` never runs. Nothing is lost:
// the finish is already saved and counted by the server, and only the
// celebration and that round of growth are skipped.
import { create } from 'zustand'
import { useVault } from '../../vault/vaultStore'
import { useCoins } from '../coins/coinStore'

const UNDO_MS = 5000
const ERROR_MS = 4000
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/

export interface PendingUndo {
  path: string
  /** The note as it was before the swipe. */
  previousRaw: string
  skipping: boolean
  /** Where they were in the note, to put them back there. */
  scrollTop: number
  /** What was held back until the swipe stands. */
  commit: () => void
}

interface SwipeUndoState {
  pending: PendingUndo | null
  error: string | null
  offer: (pending: PendingUndo) => void
  undo: () => Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null
let restoreScroll: { path: string; top: number } | null = null

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

/** The scroll position to reopen this note at, once, after an undo. */
export function takeRestoredScroll(path: string): number | null {
  if (restoreScroll?.path !== path) return null
  const { top } = restoreScroll
  restoreScroll = null
  return top
}

export const useSwipeUndo = create<SwipeUndoState>((set, get) => ({
  pending: null,
  error: null,

  offer: (pending) => {
    // A second swipe inside the window: the first one stands.
    clearTimer()
    get().pending?.commit()
    set({ pending, error: null })
    timer = setTimeout(() => {
      timer = null
      set({ pending: null })
      pending.commit()
    }, UNDO_MS)
  },

  undo: async () => {
    const pending = get().pending
    if (!pending) return
    clearTimer()
    set({ pending: null })
    const { getNote, saveNote, openNote } = useVault.getState()
    try {
      const current = getNote(pending.path)
      if (!current) throw new Error('note not found')
      // Only the frontmatter goes back: a background draft may have written
      // the body in these few seconds, and that should survive the undo.
      const frontmatter = pending.previousRaw.match(FRONTMATTER)?.[0]
      const raw = frontmatter ? current.raw.replace(FRONTMATTER, () => frontmatter) : pending.previousRaw
      await saveNote(pending.path, raw, { undoFinish: true })
      // The coins were paid at the swipe; the server has just taken the
      // finish back, so show the balance it now has.
      useCoins.getState().sync(800)
      restoreScroll = { path: pending.path, top: pending.scrollTop }
      openNote(pending.path)
    } catch {
      // The swipe stands, so what it held back goes ahead.
      pending.commit()
      set({ error: 'Could not undo that' })
      timer = setTimeout(() => {
        timer = null
        set({ error: null })
      }, ERROR_MS)
    }
  },
}))
