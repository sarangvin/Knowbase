import { useEffect } from 'react'
import { useVault } from '../vault/vaultStore'

/** Global Obsidian-style shortcuts. Mounted once by App. */
export function useKeybindings() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const s = useVault.getState()
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (mod && e.key === 'p' && !e.shiftKey) {
        e.preventDefault()
        s.setPaletteOpen(!s.paletteOpen)
      } else if (mod && e.key === 'o') {
        e.preventDefault()
        s.setQuickSwitchOpen(!s.quickSwitchOpen)
      } else if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        s.setSearchOpen(true)
      } else if (mod && e.key === 'e') {
        e.preventDefault()
        if (s.activeView()?.kind === 'note') s.setMode(s.mode === 'read' ? 'edit' : 'read')
      } else if (mod && e.key === 'g' && !typing) {
        e.preventDefault()
        s.openView({ kind: 'graph' })
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        s.toggleLeft()
      } else if (e.key === 'Escape') {
        if (s.paletteOpen) s.setPaletteOpen(false)
        if (s.quickSwitchOpen) s.setQuickSwitchOpen(false)
      } else if (!typing && (e.altKey) && e.key === 'ArrowLeft') {
        e.preventDefault()
        s.back()
      } else if (!typing && (e.altKey) && e.key === 'ArrowRight') {
        e.preventDefault()
        s.forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
