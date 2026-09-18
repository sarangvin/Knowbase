// importance / interest / confidence as draggable 0-5 sliders.
//
// These three are the inputs to the Next Up ranking, so they are the numbers
// a reader most often wants to change — and changing them used to mean
// switching to edit mode and hand-editing YAML. Confidence especially: the
// whole loop is "study this, then say how well you know it now".
//
// Writes go through a surgical single-line frontmatter edit (see
// setFrontmatterValue), not a YAML re-dump, so moving a slider does not
// reformat a file the user may also be editing in Obsidian.
import { useEffect, useRef, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { setFrontmatterValue } from '../../vault/parse'
import './score.css'

const MAX = 5
/** Long enough to swallow a drag, short enough that a click then navigating
 *  away still lands. */
const SAVE_DEBOUNCE_MS = 400

export function ScoreSlider({ notePath, field, value }: { notePath: string; field: string; value: number }) {
  const saveNote = useVault((s) => s.saveNote)
  const getNote = useVault((s) => s.getNote)
  const source = useVault((s) => s.source)

  const writable = !!source?.writable && (source.isPathWritable?.(notePath) ?? true)

  const [local, setLocal] = useState(value)
  const [error, setError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow the note when it changes underneath us — navigating to another
  // note reuses this component, and a background draft can rewrite the file.
  useEffect(() => setLocal(value), [value, notePath])

  // A pending save must not fire against the note we just navigated away
  // from; flush the timer on unmount and on path change.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [notePath],
  )

  const commit = (next: number) => {
    setLocal(next)
    if (!writable) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // Re-read at write time rather than closing over the note: a
      // background draft may have replaced the body since this rendered, and
      // writing a stale copy would silently undo it.
      const current = getNote(notePath)
      if (!current) return
      const updated = setFrontmatterValue(current.raw, field, next)
      if (updated === current.raw) return
      saveNote(notePath, updated).then(
        () => setError(false),
        (err) => {
          console.warn('[score-slider] save failed', err)
          setError(true)
        },
      )
    }, SAVE_DEBOUNCE_MS)
  }

  const pct = (local / MAX) * 100

  return (
    <div className={`score${error ? ' score-error' : ''}`}>
      <input
        className="score-range"
        type="range"
        min={0}
        max={MAX}
        step={1}
        value={local}
        disabled={!writable}
        aria-label={field}
        // Track fill is painted from a custom property so one gradient rule
        // covers both engines' very different range internals.
        style={{ ['--fill' as string]: `${pct}%` }}
        onChange={(e) => commit(Number(e.target.value))}
      />
      <output className="score-out">
        {local}
        <span className="score-max">/{MAX}</span>
      </output>
      {error && <span className="score-err" title="Could not save">!</span>}
    </div>
  )
}
