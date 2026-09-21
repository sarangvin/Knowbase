// The Questions section's half of /api/notes. The server owns the answers,
// the rate limit and every write to the note.
import { localDay } from '../automated-graph/engine'

async function jsonOrThrow(res: Response): Promise<unknown> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  // The server's messages here are written to be read by the user — "that's
  // your question for today" is more use than "429".
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export interface AnswerResult {
  answer: string
  alreadyAnswered?: boolean
  /** Custom questions left today for this collection; null when uncapped. */
  remaining?: number | null
}

export async function answerQuestion(path: string, question: string, custom: boolean): Promise<AnswerResult> {
  const res = await fetch('/api/notes/answer', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, question, custom, day: localDay() }),
  })
  return (await jsonOrThrow(res)) as AnswerResult
}

export async function deleteQuestion(path: string, question: string): Promise<void> {
  const res = await fetch(
    `/api/notes/question?path=${encodeURIComponent(path)}&question=${encodeURIComponent(question)}`,
    { method: 'DELETE', credentials: 'include' },
  )
  await jsonOrThrow(res)
}

export interface Allowance {
  /** null on a plan with no cap. */
  limit: number | null
  used: number
  /** null means "as many as you like", not "none left". */
  remaining: number | null
}

export async function fetchAllowance(space: string): Promise<Allowance> {
  const res = await fetch(
    `/api/notes/question-allowance?space=${encodeURIComponent(space)}&day=${encodeURIComponent(localDay())}`,
    { credentials: 'include' },
  )
  return (await jsonOrThrow(res)) as Allowance
}

/** The questions on this note that the reader wrote themselves — the only
 *  ones they can delete. Empty on any failure: showing no delete buttons is
 *  the safe way to be wrong. */
export async function fetchOwnQuestions(path: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/notes/custom-questions?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    })
    if (!res.ok) return []
    return ((await res.json()) as { questions: string[] }).questions
  } catch {
    return []
  }
}
