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
  const openView = useVault((s) => s.openView)
  const getNote = useVault((s) => s.getNote)

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
    if (view?.kind === 'flashcards') return 'flashcards'
    if (view?.kind === 'settings') return 'settings'
    if (view?.kind === 'note') {
      if (/\/Next Up\.md$/i.test(view.path)) return 'next'
      // The vault's own Flashcards.md dashboard still exists and is still
      // openable from Files; the tab no longer points at it, but landing on
      // it should still light this tab up rather than none.
      if (/(^|\/)Flashcards\.md$/i.test(view.path)) return 'flashcards'
    }
    return null
  })()

  const tabs: { id: TabId; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }[] = [
    {
      id: 'next',
      label: 'Learn',
      icon: <Rabbit />,
      onClick: () => openView({ kind: 'home' }),
    },
    { id: 'files', label: 'Files', icon: <Folder />, onClick: () => openView({ kind: 'files' }) },
    // Was a link to the vault's Flashcards.md dashboard, and so was disabled
    // on any vault that happened not to have that file. It is a destination
    // now, like Quiz: the cards are dealt by the server from reviewed notes,
    // not read out of a note.
    { id: 'flashcards', label: 'Flashcards', icon: <Layers />, onClick: () => openView({ kind: 'flashcards' }) },
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
