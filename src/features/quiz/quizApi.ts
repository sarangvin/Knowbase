// The quiz tab's half of /api/quiz. The server owns the questions, the
// answer key and the score; this only asks and renders.
import { localDay } from '../automated-graph/engine'

export interface QuizQuestion {
  noteTitle: string
  notePath: string
  question: string
  options: string[]
  /** Index the user picked, or null if they have not yet. */
  chosen: number | null
  /** Index of the correct option — null until they have answered it. */
  answer: number | null
}

export interface Quiz {
  day: string
  score: number
  total: number
  completed: boolean
  questions: QuizQuestion[]
}

export interface QuizToday {
  quiz: Quiz | null
  /** How many questions the vault could supply. Null when a quiz already
   *  exists, because then it does not matter. */
  available: number | null
  /** How many distinct reviewed notes those came from. */
  notes?: number
  needed?: number
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  // The server's messages here are written to be read by the user — "review
  // a note or two first" is more use than "409".
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function fetchToday(): Promise<QuizToday> {
  const res = await fetch(`/api/quiz/today?day=${encodeURIComponent(localDay())}`, { credentials: 'include' })
  return (await jsonOrThrow(res)) as QuizToday
}

export async function startToday(): Promise<Quiz> {
  const res = await fetch('/api/quiz/today', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: localDay() }),
  })
  return ((await jsonOrThrow(res)) as { quiz: Quiz }).quiz
}

export interface AnswerResult {
  correct: boolean
  answer: number
  score: number
  completed: boolean
}

export async function answerQuestion(index: number, choice: number): Promise<AnswerResult> {
  const res = await fetch('/api/quiz/answer', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: localDay(), index, choice }),
  })
  return (await jsonOrThrow(res)) as AnswerResult
}
