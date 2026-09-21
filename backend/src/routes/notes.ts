// Answering questions on a note: the generated ones, and the ones the reader
// writes themselves.
//
// The server owns all of it. Answering costs a model call, custom questions
// are rate-limited, and a limit the client enforces is not a limit — the same
// reasoning the quiz and the flashcard deck are built on.
import { Router } from 'express'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customQuestions } from '../db/schema.js'
import { requireAuth, requireApproved } from '../auth/session.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { getOrCreatePersonalVaultId, spaceOf } from '../vault/spaces.js'
import {
  parseQuestions,
  setAnswer,
  appendQuestion,
  removeQuestion,
  contextOf,
  generateAnswer,
  loadOwnNote,
  writeOwnNote,
} from '../notes/questions.js'

export const notesRouter = Router()
notesRouter.use(requireAuth)
notesRouter.use(requireApproved)

/** How many questions of their own a reader may ask per day, per collection.
 *
 *  Per collection rather than per note: a collection is the unit someone
 *  studies in, and per-note would scale the allowance with how many notes
 *  the generator happened to produce — which is not a decision the reader
 *  made. One number here, as with the flashcard deck, so the limit and the
 *  copy describing it cannot disagree. */
const CUSTOM_PER_DAY_BY_PLAN: Record<string, number> = { free: 1 }
const DEFAULT_CUSTOM_PER_DAY = 1

function customPerDay(planTier?: string | null): number {
  return CUSTOM_PER_DAY_BY_PLAN[planTier ?? 'free'] ?? DEFAULT_CUSTOM_PER_DAY
}

function dayOf(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function noteParam(v: unknown): string | null {
  const p = typeof v === 'string' ? v.trim() : ''
  if (!p || p.length > 400 || p.includes('..') || p.startsWith('/')) return null
  return p
}

function questionParam(v: unknown): string | null {
  const q = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return q.length >= 5 && q.length <= 500 ? q : null
}

async function usedToday(userId: string, space: string, day: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customQuestions)
    .where(
      and(
        eq(customQuestions.userId, userId),
        eq(customQuestions.space, space),
        eq(customQuestions.day, day),
      ),
    )
  return row?.n ?? 0
}

/** What is left in today's allowance for one collection, so the input can
 *  say so before the reader types rather than after. */
notesRouter.get('/question-allowance', asyncHandler(async (req, res) => {
  const day = dayOf(req.query.day)
  const space = typeof req.query.space === 'string' ? req.query.space : ''
  if (!day || !space) {
    res.status(400).json({ error: 'day and space required' })
    return
  }
  const limit = customPerDay(req.user!.planTier)
  const used = await usedToday(req.user!.id, space, day)
  res.json({ limit, used, remaining: Math.max(0, limit - used) })
}))

/**
 * Answer a question on a note and write the answer into it.
 *
 * `custom: true` means the reader typed it: the question is added to the
 * note first and charged against the daily allowance. Otherwise it must
 * already be one of the note's own questions — which is what stops this
 * route being a general-purpose model proxy with a note attached.
 */
notesRouter.post('/answer', asyncHandler(async (req, res) => {
  const path = noteParam(req.body?.path)
  const question = questionParam(req.body?.question)
  const custom = req.body?.custom === true
  const day = dayOf(req.body?.day)
  if (!path || !question || (custom && !day)) {
    res.status(400).json({ error: 'body.path, body.question (5-500 chars) and, for a custom question, body.day are required' })
    return
  }

  const userId = req.user!.id
  const vaultId = await getOrCreatePersonalVaultId(userId)
  const note = await loadOwnNote(vaultId, path)
  if (!note) {
    res.status(404).json({ error: 'No such note.' })
    return
  }

  const space = spaceOf(path)
  const existing = parseQuestions(note.content)
  const match = existing.find((q) => q.question.toLowerCase() === question.toLowerCase())

  if (!custom && !match) {
    res.status(400).json({ error: 'That question is not on this note.' })
    return
  }
  // Already answered: hand back what is there rather than spending a call to
  // produce a second opinion nobody asked for.
  if (match?.answer) {
    res.json({ answer: match.answer, alreadyAnswered: true })
    return
  }

  let content = note.content
  let charge = false
  if (custom && !match) {
    if (!space) {
      res.status(400).json({ error: 'Custom questions are for notes inside a collection.' })
      return
    }
    const limit = customPerDay(req.user!.planTier)
    const used = await usedToday(userId, space, day!)
    if (used >= limit) {
      res.status(429).json({
        error: `That's your question for today on ${space}. You can ask another tomorrow.`,
        limit,
        used,
      })
      return
    }
    const added = appendQuestion(content, question)
    if (added == null) {
      res.status(409).json({ error: 'That question is already on this note.' })
      return
    }
    content = added
    charge = true
  }

  let answer: string
  try {
    answer = await generateAnswer(
      (path.split('/').pop() ?? path).replace(/\.md$/i, ''),
      contextOf(note.content),
      question,
      userId,
      custom ? 'note-answer-custom' : 'note-answer',
    )
  } catch (err) {
    // Nothing is written and nothing is charged: a failed call must not
    // consume the one question they get today.
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not answer just now.' })
    return
  }

  await writeOwnNote(vaultId, path, setAnswer(content, question, answer))
  if (charge && space) {
    await db.insert(customQuestions).values({ userId, space, day: day!, notePath: path, question })
  }

  const limit = customPerDay(req.user!.planTier)
  const used = space && day ? await usedToday(userId, space, day) : 0
  res.json({ answer, remaining: Math.max(0, limit - used) })
}))

/** Remove a question and its answer from a note.
 *
 *  The ledger row stays. Refunding the allowance on delete would make the
 *  daily limit "ask, delete, ask again", which is not a limit — and the
 *  model call has already been spent either way. */
notesRouter.delete('/question', asyncHandler(async (req, res) => {
  const path = noteParam(req.query.path)
  const question = questionParam(req.query.question)
  if (!path || !question) {
    res.status(400).json({ error: 'path and question required' })
    return
  }
  const vaultId = await getOrCreatePersonalVaultId(req.user!.id)
  const note = await loadOwnNote(vaultId, path)
  if (!note) {
    res.status(404).json({ error: 'No such note.' })
    return
  }
  const next = removeQuestion(note.content, question)
  if (next === note.content) {
    res.status(404).json({ error: 'That question is not on this note.' })
    return
  }
  await writeOwnNote(vaultId, path, next)
  res.json({ ok: true })
}))
