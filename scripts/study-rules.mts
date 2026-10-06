// Rule checks for stored study material and the deterministic deck/quiz
// builders. Pure: no database, no model, no network.
//   DATABASE_URL=postgres://x@localhost/none npx tsx scripts/study-rules.mts
import { readFileSync } from 'node:fs'
import { writeStudy, stripStudy, termsOf, quizOf, storedOf, cleanTerms, cleanQuiz, quizFromModel, needsStudy } from '../backend/src/notes/study.ts'
import { setAnswer, parseQuestions } from '../backend/src/notes/questions.ts'
import { buildQuestions, pickQuestions, type Candidate } from '../backend/src/quiz/build.ts'
import { dealDeck, termPool, pickSources, type NoteSource } from '../backend/src/flashcards/build.ts'
import { seededRng } from '../backend/src/util/seeded.ts'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}

const longProse = 'Photosynthesis is the process plants use to turn light into chemical energy. '.repeat(5)
const note = `---
space: Biology
status: frontier
confidence: 0
last_reviewed: 2026-10-01
---

# Photosynthesis

## AI Notes

${longProse}

**Key points**

- Chlorophyll absorbs light, mostly red and blue.

## Questions

Q: Why do plants look green?

A: Chlorophyll reflects green light rather than absorbing it.

Q: Where does the light reaction happen in the cell?
`
const study = {
  terms: [
    { term: 'Chlorophyll', definition: 'The green pigment in plant cells that captures light energy for the plant.' },
    { term: 'Stomata', definition: 'Tiny pores on a leaf surface that let gases move in and out of the plant.' },
  ],
  quiz: [
    { question: 'Why do plants look green?', stem: 'Why do most plants look green?', correct: 'They reflect green light', wrong: ['They absorb green light', 'They emit green light', 'They store green sugar'] },
    { question: 'A question that was deleted from the note', stem: 'x', correct: 'a', wrong: ['b', 'c', 'd'] },
  ],
}

// ── storage ──
const stored = writeStudy(note, study)
check('study: section is appended last', stored.trimEnd().endsWith('-->') && stored.includes('\n## Study data\n'))
check('study: round-trips', JSON.stringify(storedOf(stored)) === JSON.stringify(study))
check('study: stripStudy removes it entirely', !stripStudy(stored).includes('Study data') && !stripStudy(stored).includes('rabbithole'))
check('study: strip then write is idempotent (no duplicate sections)', (writeStudy(stored, study).match(/## Study data/g) ?? []).length === 1)
const dashed = writeStudy(note, { terms: [{ term: 'Light--dark', definition: 'A made-up term that contains a double hyphen -- inside its text.' }], quiz: [] })
check('study: "--" inside text cannot close the HTML comment early', (dashed.match(/-->/g) ?? []).length === 1 && storedOf(dashed)?.terms[0].term === 'Light--dark')
check('study: a note without it has none', storedOf(note) === null && termsOf(note).length === 0 && quizOf(note).length === 0)
check('study: needsStudy true before, false after', needsStudy(note) && !needsStudy(stored))

// ── it must not be swallowed by the Questions section ──
const answered = setAnswer(stored, 'Where does the light reaction happen in the cell?', 'In the thylakoid membranes of the chloroplast.')
check('questions: answering leaves the study section intact', JSON.stringify(storedOf(answered)) === JSON.stringify(study))
check('questions: study text is not parsed as a question', parseQuestions(stored).length === 2)

// ── reading is checked against the note as it is now ──
check('quiz: item whose question was deleted is dropped', quizOf(stored).length === 1 && quizOf(stored)[0].question === 'Why do plants look green?')
check('terms: a term removed from the note is dropped', termsOf(stored).map((t) => t.term).join() === 'Chlorophyll')

// ── validation ──
check('cleanTerms: drops a definition that contains its own term', cleanTerms([{ term: 'Chlorophyll', definition: 'Chlorophyll is the green pigment that absorbs the light.' }], '').length === 0)
check('cleanTerms: drops the note title as a term', cleanTerms([{ term: 'Photosynthesis', definition: 'The way a plant makes its own food from light and water.' }], 'Photosynthesis').length === 0)
check('cleanTerms: caps at 4', cleanTerms(Array.from({ length: 9 }, (_, i) => ({ term: `Zyx${i}q`, definition: `A sufficiently long explanation number ${i} of something in biology.` })), '').length === 4)
check('cleanQuiz: needs 3 distinct wrong answers', cleanQuiz([{ question: 'q?', stem: 's', correct: 'a', wrong: ['b', 'b', 'c'] }]).length === 0)
check('cleanQuiz: correct answer repeated among wrong ones is rejected', cleanQuiz([{ question: 'q?', stem: 's', correct: 'a', wrong: ['A', 'c', 'd'] }]).length === 0)
{
  const [q] = cleanQuiz([{ question: 'q?', stem: 's', correct: 'The right one.', wrong: ['Wrong one', 'Another wrong.', 'Third'] }])
  check('cleanQuiz: no option keeps a trailing full stop (the right one must not stand out)', !!q && ![q.correct, ...q.wrong].some((o) => o.endsWith('.')))
}
check('quizFromModel: maps n to the question text', quizFromModel([{ n: 2, stem: 's', correct: 'a', wrong: ['b', 'c', 'd'] }], ['first?', 'second?'])[0]?.question === 'second?')
check('quizFromModel: an out-of-range n is dropped', quizFromModel([{ n: 9, stem: 's', correct: 'a', wrong: ['b', 'c', 'd'] }], ['first?']).length === 0)

// ── determinism ──
const a = seededRng('u|2026-10-06|quiz'), b = seededRng('u|2026-10-06|quiz'), c = seededRng('u|2026-10-07|quiz')
const seq = (r: () => number) => Array.from({ length: 5 }, r).join()
check('seeded: same seed, same sequence', seq(a) === seq(b))
check('seeded: different day, different sequence', seq(seededRng('u|2026-10-06|quiz')) !== seq(c))

const cands: Candidate[] = Array.from({ length: 12 }, (_, i) => ({
  notePath: `Space/Topics/n${i % 6}.md`, noteTitle: `n${i % 6}`, question: `Question ${i}?`, correct: `right ${i}`, wrong: [`w1 ${i}`, `w2 ${i}`, `w3 ${i}`],
}))
const quizOnce = () => { const r = seededRng('u|d|quiz'); return buildQuestions(pickQuestions(cands, r), r) }
check('quiz: same inputs give the same quiz', JSON.stringify(quizOnce()) === JSON.stringify(quizOnce()))
const q = quizOnce()
check('quiz: five questions, from five different notes', q.length === 5 && new Set(q.map((x) => x.notePath)).size === 5)
check('quiz: the marked answer is the stored correct option', q.every((x) => x.options[x.answer].startsWith('right ')))
check('quiz: every question has 4 distinct options', q.every((x) => x.options.length === 4 && new Set(x.options).size === 4))
const positions = new Set(Array.from({ length: 40 }, (_, i) => { const r = seededRng(`user${i}|d|quiz`); return buildQuestions(pickQuestions(cands, r), r)[0].answer }))
check('quiz: the correct answer is not always in the same position', positions.size > 1)

const sources: NoteSource[] = Array.from({ length: 14 }, (_, i) => ({
  notePath: `Space/Topics/f${i}.md`, noteTitle: `f${i}`, weight: 1 + (i % 5),
  terms: [{ term: `term${i}a`, definition: `definition for term ${i}a that is long enough` }, { term: `term${i}b`, definition: `definition for term ${i}b that is long enough` }],
}))
const deckOnce = (seed: string) => { const r = seededRng(seed); return dealDeck(termPool(pickSources(sources, 10, r)), 10, new Map(), '2026-10-06', r) }
check('flashcards: same inputs give the same deck', JSON.stringify(deckOnce('u|d|f')) === JSON.stringify(deckOnce('u|d|f')))
check('flashcards: 10 distinct cards', new Set(deckOnce('u|d|f').map((x) => x.term)).size === 10)
const fronts = deckOnce('u|d|f').filter((x) => x.front === 'term').length
check('flashcards: faces are balanced 5/5', fronts === 5)

// ── the point of all this: no model call when dealing ──
const readSrc = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
check('no model import in flashcards/build.ts', !/meter\.js|meteredGeminiCall/.test(readSrc('../backend/src/flashcards/build.ts')))
check('no model import in quiz/build.ts', !/meter\.js|meteredGeminiCall/.test(readSrc('../backend/src/quiz/build.ts')))
check('quiz/flashcards routes do not call a model', !/meteredGeminiCall|streamGeminiChat/.test(readSrc('../backend/src/routes/quiz.ts') + readSrc('../backend/src/routes/flashcards.ts')))

console.log(failed ? `\n${failed} FAILED` : '\nall study checks passed')
process.exit(failed ? 1 : 0)
