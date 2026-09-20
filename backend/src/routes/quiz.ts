// One quiz a day, five questions, drawn from notes the user has reviewed.
//
// The server owns the whole thing — which questions, which options, which is
// right, and what the score is. The client is a renderer. That is not
// defensiveness about cheating (you can only cheat yourself here); it is
// that a quiz which regenerates when you reload is not the same quiz, and a
// daily cap the client enforces is not a cap.
import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { quizzes } from '../db/schema.js'
import type { QuizQuestionRow } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { getOrCreatePersonalVaultId } from '../vault/spaces.js'
import { collectCandidates, pickQuestions, buildQuestions, QUIZ_LENGTH } from '../quiz/build.js'

export const quizRouter = Router()
quizRouter.use(requireAuth)
quizRouter.use(requireApproved)

/** Local date as the client keeps it. The review cap already works this way,
 *  so "one a day" means one calendar day where the user is rather than
 *  wherever the database happens to think it is. */
function dayOf(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/** What the client is allowed to see. The correct answer for a question they
 *  have not answered yet is withheld — not because they would cheat, but
 *  because a payload that contains the answer makes "tap to find out" a
 *  polite fiction, and someone will eventually build a UI on it. */
function present(q: QuizQuestionRow) {
  return {
    noteTitle: q.noteTitle,
    notePath: q.notePath,
    question: q.question,
    options: q.options,
    chosen: q.chosen,
    answer: q.chosen == null ? null : q.answer,
  }
}

function view(row: { day: string; questions: QuizQuestionRow[]; score: number; completedAt: Date | null }) {
  return {
    day: row.day,
    score: row.score,
    total: row.questions.length,
    completed: row.completedAt != null,
    questions: row.questions.map(present),
  }
}

async function todaysRow(userId: string, day: string) {
  const [row] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.userId, userId), eq(quizzes.day, day)))
    .limit(1)
  return row ?? null
}

/** Today's quiz if it exists, plus how much material there is to build one
 *  from. The count is what lets the empty state say "review two more notes"
 *  instead of "nothing here". */
quizRouter.get('/today', asyncHandler(async (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) {
    res.status(400).json({ error: 'day (YYYY-MM-DD) required' })
    return
  }
  const userId = req.user!.id
  const row = await todaysRow(userId, day)
  if (row) {
    res.json({ quiz: view(row), available: null })
    return
  }
  const vaultId = await getOrCreatePersonalVaultId(userId)
  const candidates = await collectCandidates(vaultId)
  res.json({
    quiz: null,
    available: candidates.length,
    notes: new Set(candidates.map((c) => c.notePath)).size,
    needed: QUIZ_LENGTH,
  })
}))

/** Build today's quiz, or hand back the one already built.
 *
 *  The unique index on (user, day) is what enforces one a day; this returns
 *  the existing row rather than erroring, so a double tap on "Start" is a
 *  no-op instead of a failure message for something that worked. */
quizRouter.post('/today', asyncHandler(async (req, res) => {
  const day = dayOf(req.body?.day)
  if (!day) {
    res.status(400).json({ error: 'body.day (YYYY-MM-DD) required' })
    return
  }
  const userId = req.user!.id

  const existing = await todaysRow(userId, day)
  if (existing) {
    res.json({ quiz: view(existing) })
    return
  }

  const vaultId = await getOrCreatePersonalVaultId(userId)
  const candidates = await collectCandidates(vaultId)
  if (candidates.length === 0) {
    res.status(409).json({ error: 'No questions yet — review a note or two first.' })
    return
  }

  const questions = await buildQuestions(pickQuestions(candidates), userId)
  if (questions.length === 0) {
    res.status(502).json({ error: 'Could not put a quiz together just now. Try again in a moment.' })
    return
  }

  // onConflictDoNothing, then re-read: two tabs pressing Start at the same
  // moment must end up looking at the same quiz, not one each.
  await db
    .insert(quizzes)
    .values({ userId, day, questions, score: 0 })
    .onConflictDoNothing({ target: [quizzes.userId, quizzes.day] })
  const row = await todaysRow(userId, day)
  if (!row) {
    res.status(500).json({ error: 'Could not save the quiz.' })
    return
  }
  res.json({ quiz: view(row) })
}))

/** Answer one question. Returns whether it was right, so the client never
 *  has to hold the answer key. */
quizRouter.post('/answer', asyncHandler(async (req, res) => {
  const day = dayOf(req.body?.day)
  const index = Number(req.body?.index)
  const choice = Number(req.body?.choice)
  if (!day || !Number.isInteger(index) || !Number.isInteger(choice)) {
    res.status(400).json({ error: 'body.day, body.index and body.choice required' })
    return
  }
  const userId = req.user!.id
  const row = await todaysRow(userId, day)
  if (!row) {
    res.status(404).json({ error: 'No quiz for that day.' })
    return
  }
  const questions = row.questions
  const q = questions[index]
  if (!q) {
    res.status(400).json({ error: 'No such question.' })
    return
  }
  if (choice < 0 || choice >= q.options.length) {
    res.status(400).json({ error: 'No such option.' })
    return
  }
  // First answer stands. Re-answering would make the score a record of how
  // many times you were willing to try, which is not what it is for.
  if (q.chosen != null) {
    res.json({ correct: q.chosen === q.answer, answer: q.answer, score: row.score, completed: row.completedAt != null, alreadyAnswered: true })
    return
  }

  q.chosen = choice
  const correct = choice === q.answer
  const score = row.score + (correct ? 1 : 0)
  const completed = questions.every((x) => x.chosen != null)

  await db
    .update(quizzes)
    .set({ questions, score, completedAt: completed ? new Date() : null })
    .where(eq(quizzes.id, row.id))

  res.json({ correct, answer: q.answer, score, completed })
}))
