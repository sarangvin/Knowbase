import { useEffect, useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { useVault } from '../../vault/vaultStore'
import './editor.css'

// Dark theme matching the app's design tokens (CodeMirror needs concrete colors).
const knowbaseTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#1e1e1e', color: '#dcddde', height: '100%' },
    '.cm-content': {
      fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
      fontSize: '14.5px',
      lineHeight: '1.7',
      caretColor: '#9b7ed6',
      maxWidth: '820px',
      margin: '0 auto',
      padding: '28px 24px 40vh',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#9b7ed6' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(155, 126, 214, 0.25)',
    },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.02)' },
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
        theme={knowbaseTheme}
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
