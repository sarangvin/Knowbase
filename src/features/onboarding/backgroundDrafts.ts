// Hands the remaining note drafts to the server, then gets out of the way.
//
// This used to do the drafting in the browser. That only worked while the tab
// stayed open: close it, lock the phone or switch apps and the rest of the
// notes were never written, leaving a vault stuck on one-line summaries with
// no way to retry. The server does the work now (POST /api/draft-notes),
// returns 202 straight away and continues under waitUntil, so it survives the
// client disappearing.
//
// Still a plain function rather than a hook: TopicOnboarding unmounts the
// instant the vault stops being empty, so anything on its lifecycle would be
// torn down before it ran.
import { contributeToLibrary } from '../../vault/remoteSource'
import type { Subtopic } from './notePlan'

export interface PendingDraft {
  path: string
  title: string
  subtopic: Subtopic
  /** Exact text written at creation, so the server can tell an untouched note
   *  from one the user has since edited and must not overwrite. */
  placeholder: string
}

export function draftRemainingInBackground(
  space: string,
  pending: PendingDraft[],
  _siblings: string[],
  done: { path: string; content: string }[],
): void {
  // Contribute what is already final. The drafts the server is about to write
  // are contributed by nobody — a gap worth accepting for now, since the
  // alternative is the client polling to find out when they land.
  void contributeToLibrary(done)
  if (pending.length === 0) return

  void fetch('/api/draft-notes', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      space,
      items: pending.map((d) => ({
        path: d.path,
        title: d.title,
        summary: d.subtopic.summary,
        placeholder: d.placeholder,
      })),
    }),
  }).catch((err) => {
    // Nothing to recover: the user has their notes, just with summaries.
    console.warn('[draft-notes] could not hand off to the server:', err)
  })
}
