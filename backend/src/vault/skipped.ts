// A topic the reader marked "not interested": passed over, not finished.
//
// It keeps its `last_reviewed` date — that is what lets the topics built on
// it unlock and the collection grow past it — but it is not complete. So it
// is kept out of the quiz and the flashcards, and finishing it logs a
// `note_skip` event rather than `note_review`, which is what keeps it out of
// the streak and the coin balance. Notes from before the flag existed say
// the same thing with `interest: 1`, which is exactly what a swipe left
// wrote. Mirrored on the client by isSkipped in automated-graph/engine.ts.
import { frontmatterNumber, frontmatterValue } from './frontmatter.js'

export function isSkippedNote(content: string): boolean {
  if (String(frontmatterValue(content, 'skipped')).toLowerCase() === 'true') return true
  const interest = frontmatterNumber(content, 'interest', 0)
  return !!frontmatterValue(content, 'last_reviewed') && interest > 0 && interest <= 1
}
