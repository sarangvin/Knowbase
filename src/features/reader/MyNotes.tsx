// The one part of a generated note that is yours.
//
// Everything above it was written by a model and gets rewritten by one: the
// draft queue replaces placeholders, Sync folds and rewrites AI Notes. This
// section is the exception, and it is editable in place rather than behind
// the edit-mode toggle, because "jot down the thing you just realised" is
// not an action worth changing modes for.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { Save } from '../../ui/icons'
import { slugify } from '../../vault/parse'
import { replaceSection } from '../sync/sync'
import type { Note } from '../../vault/types'

/** Long enough that a pause between words never costs a save, short enough
 *  that closing the tab a second after typing does not lose one. A blur
 *  flushes immediately, which covers the common way people leave.
 *
 *  The Save button does the same thing on demand. Autosave alone leaves
 *  people wondering whether their writing is safe, and a button alone
 *  loses the writing of anyone who assumed it was. */
const SAVE_AFTER_MS = 700

export function MyNotes({ note, initial }: { note: Note; initial: string }) {
  const saveNote = useVault((s) => s.saveNote)
  const writable = useVault((s) => s.writable)

  const [text, setText] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Tracked in state, not derived from a ref, because the Save button's
  // enabled-ness has to re-render when it changes.
  const [dirty, setDirty] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number | null>(null)
  // What is actually on disk, so a save is skipped when nothing changed and
  // the debounce does not fight the re-render that follows a save.
  const savedRef = useRef(initial)

  // Switching notes must not carry the previous note's text across.
  useEffect(() => {
    setText(initial)
    savedRef.current = initial
    setDirty(false)
    setState('idle')
  }, [note.path, initial])

  // Grow to fit. useLayoutEffect so the height is right in the same frame as
  // the text, otherwise every keystroke that adds a line flashes a scrollbar.
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    // Reset first: scrollHeight only ever grows while the box is already
    // tall enough to hold the content, so shrinking needs a measurement
    // from zero.
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const flush = async (value: string) => {
    if (value === savedRef.current) {
      setDirty(false)
      return
    }
    setState('saving')
    try {
      // Written through the same section helper Sync uses, so there is one
      // definition of where "## My Notes" starts and ends. An empty box
      // leaves the heading in place with nothing under it, which is what an
      // untouched note looks like.
      await saveNote(note.path, replaceSection(note.raw, 'My Notes', value.trim()))
      savedRef.current = value
      setDirty(false)
      setState('saved')
    } catch {
      setState('error')
    }
  }

  const onChange = (value: string) => {
    setText(value)
    setDirty(value !== savedRef.current)
    setState('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(value), SAVE_AFTER_MS)
  }

  // A pending save must not be dropped by navigating away.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <section className="mynotes">
      <h2 id={slugify('My Notes')}>My Notes</h2>
      {writable ? (
        <>
          <textarea
            ref={areaRef}
            className="mynotes-input"
            value={text}
            placeholder="Anything you want to remember about this — in your own words. Optional, and only you can see it."
            spellCheck
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current)
              void flush(text)
            }}
          />
          <div className="mynotes-foot">
            <div className="mynotes-status" aria-live="polite">
              {state === 'saving' && 'Saving…'}
              {state === 'saved' && !dirty && 'Saved'}
              {dirty && state !== 'saving' && 'Unsaved changes'}
              {state === 'error' && <span className="mynotes-error">Could not save — your text is still here.</span>}
            </div>
            <button
              type="button"
              className="mynotes-save"
              // Nothing to send and nothing to reassure them about: a button
              // that stays lit after a successful save invites a second
              // pointless write and makes "Saved" look like a guess.
              disabled={!dirty || state === 'saving'}
              onClick={() => {
                if (timer.current) clearTimeout(timer.current)
                void flush(text)
              }}
            >
              <Save width={13} height={13} /> {state === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        // The demo vault and a read-only folder both land here. Showing an
        // input that silently fails to save would be worse than showing
        // what is there.
        <p className="mynotes-readonly">{text.trim() || 'Nothing here yet.'}</p>
      )}
    </section>
  )
}
