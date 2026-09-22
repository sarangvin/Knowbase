// Filling in the answers that were never written.
//
// The Questions section only started shipping answers with the note recently.
// Everything drafted before that has questions and no answers, and the reader
// has to press Answer and wait for each one. This walks those notes and fills
// them, one model call per note rather than one per question — 568 unanswered
// questions is more than a day's whole quota at a call each, and about 300
// when batched.
//
// Written as a bounded, resumable pass rather than a one-off script: it
// yields to the shared daily ceiling, stops on a budget, and can be run again
// to pick up where it left off, because "which notes still need this" is a
// query rather than a cursor.
import { and, eq, like, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { notes, usageEvents, vaults } from '../db/schema.js'
import { SPACE_ROOT } from '../vault/spaces.js'
import { parseQuestions, setAnswer, contextOf, generateAnswers, unanswered } from './questions.js'

export interface BackfillOptions {
  /** Most notes to touch in one pass. One model call each. */
  limit: number
  /** Stop once this many llm_calls have been made in the last 24h, so a
   *  backfill cannot eat the ceiling that real usage shares. */
  dailyCallBudget: number
  /** 'personal' fills what users actually read; 'global' fills the corpus so
   *  the next person to adopt a space gets answers too. */
  vaultKind: 'personal' | 'global'
  /** Wall-clock stop, for callers that run inside a request. */
  budgetMs?: number
  /** Gap between notes. The free tier allows 15 requests a minute and this
   *  loop is the only thing in the product that would ever run flat out, so
   *  it paces itself rather than discovering the limit as a wall of 429s.
   *  4.5s is about 13 a minute, comfortably under. */
  pauseMs?: number
}

export interface BackfillResult {
  notesConsidered: number
  notesFilled: number
  answersWritten: number
  questionsSkipped: number
  stoppedBecause: 'done' | 'limit' | 'quota' | 'time' | 'no-key'
}

async function callsInLastDay(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.eventType, 'llm_call'),
        sql`${usageEvents.createdAt} > now() - interval '24 hours'`,
      ),
    )
  return row?.n ?? 0
}

/**
 * One pass. Returns what it did; never throws, so a caller running it on a
 * schedule cannot be taken down by one malformed note.
 */
export async function backfillAnswers(opts: BackfillOptions): Promise<BackfillResult> {
  const started = Date.now()
  const out: BackfillResult = {
    notesConsidered: 0,
    notesFilled: 0,
    answersWritten: 0,
    questionsSkipped: 0,
    stoppedBecause: 'done',
  }
  if (!process.env.GEMINI_API_KEY) return { ...out, stoppedBecause: 'no-key' }

  // Candidates are found by SQL that is deliberately loose — "has a Questions
  // section" — and narrowed in JS by the real parser. Encoding the question
  // grammar twice, once in SQL and once in TypeScript, is how the two drift.
  const rows = await db
    .select({ id: notes.id, path: notes.path, content: notes.content, vaultId: notes.vaultId })
    .from(notes)
    .innerJoin(vaults, eq(vaults.id, notes.vaultId))
    .where(and(eq(vaults.kind, opts.vaultKind), like(notes.path, `${SPACE_ROOT}%/Topics/%`)))
    .then((r) => r.map((x) => x))

  const owners = new Map<string, string | null>()
  for (const v of await db.select({ id: vaults.id, owner: vaults.ownerUserId }).from(vaults)) {
    owners.set(v.id, v.owner)
  }

  for (const row of rows) {
    const questions = unanswered(row.content)
    if (questions.length === 0) continue
    out.notesConsidered++

    if (out.notesFilled >= opts.limit) {
      out.stoppedBecause = 'limit'
      break
    }
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) {
      out.stoppedBecause = 'time'
      break
    }
    if ((await callsInLastDay()) >= opts.dailyCallBudget) {
      out.stoppedBecause = 'quota'
      break
    }

    if (opts.pauseMs && out.notesFilled > 0) await new Promise((r) => setTimeout(r, opts.pauseMs))

    const title = (row.path.split('/').pop() ?? row.path).replace(/\.md$/i, '')
    let answers: (string | null)[]
    try {
      answers = await generateAnswers(
        title,
        contextOf(row.content),
        questions,
        // The corpus has no owner to bill; a personal note bills its owner,
        // which is whose quota an answer on their note spends.
        owners.get(row.vaultId) ?? undefined,
        'answer-backfill',
      )
    } catch (err) {
      console.warn(`[backfill] ${row.path} failed:`, err)
      out.questionsSkipped += questions.length
      continue
    }

    // Re-read before writing. A draft or a reader may have touched this note
    // since the query, and an answer written over their edit is worse than an
    // answer not written.
    const [fresh] = await db
      .select({ content: notes.content })
      .from(notes)
      .where(and(eq(notes.vaultId, row.vaultId), eq(notes.path, row.path)))
      .limit(1)
    if (!fresh) continue

    let content = fresh.content
    let wrote = 0
    const stillOpen = new Set(unanswered(content))
    questions.forEach((q, i) => {
      const a = answers[i]
      if (!a) {
        out.questionsSkipped++
        return
      }
      if (!stillOpen.has(q)) return
      const next = setAnswer(content, q, a)
      if (next !== content) {
        content = next
        wrote++
      }
    })

    if (wrote > 0) {
      await db
        .update(notes)
        .set({ content, sizeBytes: Buffer.byteLength(content, 'utf8'), mtime: new Date() })
        .where(and(eq(notes.vaultId, row.vaultId), eq(notes.path, row.path)))
      out.notesFilled++
      out.answersWritten += wrote
    }
  }

  return out
}

/** How much is left to do, without doing any of it. */
export async function countUnanswered(vaultKind: 'personal' | 'global'): Promise<{ notes: number; questions: number }> {
  const rows = await db
    .select({ content: notes.content })
    .from(notes)
    .innerJoin(vaults, eq(vaults.id, notes.vaultId))
    .where(and(eq(vaults.kind, vaultKind), like(notes.path, `${SPACE_ROOT}%/Topics/%`)))

  let n = 0
  let q = 0
  for (const r of rows) {
    const open = parseQuestions(r.content).filter((x) => !x.answer).length
    if (open > 0) {
      n++
      q += open
    }
  }
  return { notes: n, questions: q }
}
