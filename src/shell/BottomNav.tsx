// Primary navigation, at the bottom on every screen size.
//
// It replaces the left sidebar as the way you move around: Files is now a
// destination rather than a permanently-docked tree. Bottom placement is a
// phone idiom, but it holds up on desktop too — the destinations are always
// in the same place, and nothing about it stops working at 375px, which is
// the failure mode the old top-right icon row had.
//
// The bar also absorbs the status bar: the note counts sit on the right,
// hidden on narrow screens where the five destinations need the whole width.
// The account lives in Settings — a menu you open a handful of times does not
// earn permanent space in the chrome.
import { useVault } from '../vault/vaultStore'
import { Rabbit, Folder, Layers, Carrot, Settings } from '../ui/icons'

type TabId = 'next' | 'files' | 'flashcards' | 'quiz' | 'settings'

export function BottomNav() {
  const view = useVault((s) => s.activeView())
  const index = useVault((s) => s.index)
  const openNote = useVault((s) => s.openNote)
  const openView = useVault((s) => s.openView)
  const getNote = useVault((s) => s.getNote)

  const notes = index ? [...index.notes.values()] : []

  const flashcardsPath = (): string | null =>
    notes.find((n) => /(^|\/)Flashcards\.md$/i.test(n.path))?.path ?? null

  // Learn always goes to the collections home.
  //
  // It used to skip straight to the only space when you had one, to save a
  // tap. That was reasoning about the screen as a list and nothing else —
  // but it is also the only place you can start another collection, and the
  // only place you can reach the "what do you want to learn?" prompt on an
  // empty vault. So the people it hid that from were exactly the ones who
  // had never started a second subject, and anyone who had just reset their
  // account: with no spaces at all, this tab was disabled outright.
  //
  // One tap is worth less than being able to find the thing.

  const active = ((): TabId | null => {
    if (view?.kind === 'home') return 'next'
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
  const cardsPath = flashcardsPath()

  const tabs: { id: TabId; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }[] = [
    {
      id: 'next',
      label: 'Learn',
      icon: <Rabbit />,
      onClick: () => openView({ kind: 'home' }),
    },
    { id: 'files', label: 'Files', icon: <Folder />, onClick: () => openView({ kind: 'files' }) },
    {
      id: 'flashcards',
      label: 'Flashcards',
      icon: <Layers />,
      onClick: () => cardsPath && openNote(cardsPath),
      disabled: !cardsPath,
    },
    { id: 'quiz', label: 'Quiz', icon: <Carrot />, onClick: () => openView({ kind: 'quiz' }) },
    { id: 'settings', label: 'Settings', icon: <Settings />, onClick: () => openView({ kind: 'settings' }) },
  ]

  const note = view?.kind === 'note' ? getNote(view.path) : null
  const words = note ? note.body.trim().split(/\s+/).filter(Boolean).length : null

  return (
    <nav className="bottomnav" aria-label="Main">
      {/* Empty, but kept: with 1fr on both sides the tab group stays centred
          on the viewport rather than drifting with the width of the counts. */}
      <div className="bottomnav-side bottomnav-left" />

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
