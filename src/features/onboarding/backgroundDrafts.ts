// Finishes onboarding's note drafts after the user is already inside their
// vault.
//
// Drafting all five notes before letting anyone in meant sitting on a spinner
// for the slowest of five model calls. Only the note they land on needs to be
// ready; the rest can arrive while they read it.
//
// Deliberately not a hook or a component effect. TopicOnboarding unmounts the
// moment the vault has notes — which is the whole point — so anything tied to
// its lifecycle would be torn down immediately. This is a plain function that
// talks to the store directly and outlives the screen that started it.
import { useVault } from '../../vault/vaultStore'
import { contributeToLibrary } from '../../vault/remoteSource'
import { generateTopicNote } from './topicGeneration'
import { buildTopicNote, type Subtopic } from './notePlan'

export interface PendingDraft {
  path: string
  title: string
  subtopic: Subtopic
  /** Exact text written at creation. A note whose content still matches this
   *  has not been touched, and is safe to replace. */
  placeholder: string
}

/**
 * @param done  notes already fully drafted, for the library contribution.
 */
export function draftRemainingInBackground(
  space: string,
  pending: PendingDraft[],
  siblings: string[],
  done: { path: string; content: string }[],
): void {
  if (pending.length === 0) {
    void contributeToLibrary(done)
    return
  }

  // The source the notes belong to. If the user switches vaults mid-flight,
  // every remaining write must be abandoned rather than land somewhere else.
  const origin = useVault.getState().source

  // Writes are serialized through one chain even though generation runs in
  // parallel: saveNote rebuilds the index off current state, so overlapping
  // calls can drop each other's changes.
  let writes: Promise<void> = Promise.resolve()
  const finished: { path: string; content: string }[] = [...done]

  const queueWrite = (d: PendingDraft, content: string) => {
    writes = writes.then(async () => {
      const store = useVault.getState()
      if (store.source !== origin) return
      const current = store.getNote(d.path)
      // Gone, or edited since creation — the user's version wins. A draft is
      // worth strictly less than something they chose to write themselves.
      if (!current || current.raw !== d.placeholder) return
      try {
        await store.saveNote(d.path, content)
        finished.push({ path: d.path, content })
      } catch (err) {
        console.warn('[background-draft] could not save', d.path, err)
      }
    })
  }

  void Promise.all(
    pending.map(async (d) => {
      const body = await generateTopicNote(space, d.subtopic, siblings)
      // On failure, rewrite without the "writing a fuller draft" line rather
      // than leaving a promise the app is no longer trying to keep.
      queueWrite(d, buildTopicNote(d.title, d.subtopic, body))
    }),
  )
    .then(() => writes)
    .then(() => {
      // Contribute once, at the end, with final content. Contributing the
      // placeholders would poison the corpus with summary-only notes, and the
      // route is insert-only so a later correction could not overwrite them.
      if (useVault.getState().source === origin) void contributeToLibrary(finished)
    })
    .catch((err) => console.warn('[background-draft] failed', err))
}
