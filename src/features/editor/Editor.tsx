import { useEffect, useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { useVault } from '../../vault/vaultStore'
import './editor.css'

// Dark theme driven by the app's design tokens. EditorView.theme injects a real
// stylesheet, so var() references resolve against the editor's inherited custom
// properties — which means retinting the app in index.css retints the editor
// too, instead of leaving a hardcoded slab of the old palette behind.
const rabbitholeTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg-primary)', color: 'var(--text-normal)', height: '100%' },
    '.cm-content': {
      fontFamily: 'var(--font-mono)',
      fontSize: '14.5px',
      lineHeight: '1.7',
      caretColor: 'var(--accent)',
      maxWidth: '820px',
      margin: '0 auto',
      padding: '28px 24px 40vh',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'hsl(var(--accent-h) 80% 50% / 0.28)',
    },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'hsl(var(--soil-h) 20% 60% / 0.04)' },
    '.cm-scroller': { overflow: 'auto' },
    '&.cm-editor.cm-focused': { outline: 'none' },
  },
  { dark: true },
)

export function Editor({ notePath }: { notePath: string }) {
  const note = useVault((s) => s.getNote(notePath))
  const saveNote = useVault((s) => s.saveNote)
  const writable = useVault((s) => s.writable)
  const sourceKind = useVault((s) => s.source?.kind)
  const [text, setText] = useState(note?.raw ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(note?.raw ?? '')
    setDirty(false)
    setError(null)
  }, [notePath, note?.raw])

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    setError(null)
    try {
      await saveNote(notePath, text)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        keydown: (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault()
            void save()
            return true
          }
          return false
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notePath, text, dirty],
  )

  return (
    <div className="editor-wrap">
      {sourceKind === 'seed' ? (
        <div className="editor-banner">Demo vault — edits save in this browser only (not the original files).</div>
      ) : !writable ? (
        <div className="editor-banner">Read-only vault — open a folder you have write access to.</div>
      ) : null}
      <CodeMirror
        className="editor-cm"
        value={text}
        height="100%"
        theme={rabbitholeTheme}
        extensions={extensions}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
        onChange={(v) => {
          setText(v)
          setDirty(true)
        }}
        onBlur={() => void save()}
      />
      <div className="editor-status">
        {error ? (
          <span className="editor-err">{error}</span>
        ) : saving ? (
          'Saving…'
        ) : dirty ? (
          'Unsaved — ⌘S to save'
        ) : (
          'Saved'
        )}
      </div>
    </div>
  )
}
