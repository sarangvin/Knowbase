// Primary navigation, at the bottom on every screen size.
//
// It replaces the left sidebar as the way you move around: Files is now a
// destination rather than a permanently-docked tree. Bottom placement is a
// phone idiom, but it holds up on desktop too — the destinations are always
// in the same place, and nothing about it stops working at 375px, which is
// the failure mode the old top-right icon row had.
//
// The bar also absorbs the status bar: the account control keeps its
// bottom-left position and the note counts sit on the right, both hidden on
// narrow screens where the five destinations need the whole width. Account
// stays reachable there through the Settings tab.
import { useVault } from '../vault/vaultStore'
import { AccountButton } from './AccountButton'
import { spaceOfPath } from '../features/automated-graph/engine'
import { Sparkles, Folder, Layers, HelpCircle, Settings } from '../ui/icons'

type TabId = 'next' | 'files' | 'flashcards' | 'quiz' | 'settings'

export function BottomNav() {
  const view = useVault((s) => s.activeView())
  const index = useVault((s) => s.index)
  const openNote = useVault((s) => s.openNote)
  const openView = useVault((s) => s.openView)
  const getNote = useVault((s) => s.getNote)

  const notes = index ? [...index.notes.values()] : []

  /** Next Up lives per space, so "next learning" means the Next Up note of
   * the space you're currently reading in — falling back to the only one, or
   * the first, when that can't be determined. */
  const nextUpPath = (): string | null => {
    const all = notes.filter((n) => /\/Next Up\.md$/i.test(n.path))
    if (all.length === 0) return null
    if (view?.kind === 'note') {
      const space = spaceOfPath(view.path)
      const inSpace = space && all.find((n) => spaceOfPath(n.path) === space)
      if (inSpace) return inSpace.path
    }
    return all[0].path
  }

  const flashcardsPath = (): string | null =>
    notes.find((n) => /(^|\/)Flashcards\.md$/i.test(n.path))?.path ?? null

  const active = ((): TabId | null => {
    if (view?.kind === 'files') return 'files'
    if (view?.kind === 'quiz') return 'quiz'
    if (view?.kind === 'settings') return 'settings'
    if (view?.kind === 'note') {
      if (/\/Next Up\.md$/i.test(view.path)) return 'next'
      if (/(^|\/)Flashcards\.md$/i.test(view.path)) return 'flashcards'
    }
    return null
  })()

  // Destinations that depend on a note existing are disabled rather than
  // hidden: a nav bar whose buttons appear and disappear as you move around
  // is disorienting, and the demo vault has all of them anyway.
  const nextPath = nextUpPath()
  const cardsPath = flashcardsPath()

  const tabs: { id: TabId; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }[] = [
    {
      id: 'next',
      label: 'Next learning',
      icon: <Sparkles />,
      onClick: () => nextPath && openNote(nextPath),
      disabled: !nextPath,
    },
    { id: 'files', label: 'Files', icon: <Folder />, onClick: () => openView({ kind: 'files' }) },
    {
      id: 'flashcards',
      label: 'Flashcards',
      icon: <Layers />,
      onClick: () => cardsPath && openNote(cardsPath),
      disabled: !cardsPath,
    },
    { id: 'quiz', label: 'Quiz', icon: <HelpCircle />, onClick: () => openView({ kind: 'quiz' }) },
    { id: 'settings', label: 'Settings', icon: <Settings />, onClick: () => openView({ kind: 'settings' }) },
  ]

  const note = view?.kind === 'note' ? getNote(view.path) : null
  const words = note ? note.body.trim().split(/\s+/).filter(Boolean).length : null

  return (
    <nav className="bottomnav" aria-label="Main">
      <div className="bottomnav-side bottomnav-left">
        <AccountButton />
      </div>

      <div className="bottomnav-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            aria-label={t.label}
            title={t.label}
            disabled={t.disabled}
            className={`navtab${active === t.id ? ' navtab-active' : ''}`}
            onClick={t.onClick}
          >
            {t.icon}
            <span className="navtab-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="bottomnav-side bottomnav-right">
        <span>{index?.notes.size ?? 0} notes</span>
        {words != null && <span>{words} words</span>}
      </div>
    </nav>
  )
}
