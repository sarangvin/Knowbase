// Rule checks for the streak and the tier limits. Pure: no database, no
// network. Run by scripts/validate-deploy.sh, or on its own:
//   DATABASE_URL=postgres://x@localhost/none npx tsx scripts/streak-rules.mts
import { computeStreak } from '../backend/src/usage/streak.ts'
import { limitsFor, tierOf, NEW_ACCOUNTS_DAILY_MODEL_CALLS } from '../backend/src/plans.ts'
import { DEFAULT_MODEL_CHAIN, configuredChain } from '../backend/src/llm/models.ts'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}

const T = '2026-10-06'
const d = (n: number) => {
  const x = new Date(`${T}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() - n)
  return x.toISOString().slice(0, 10)
}
const streak = (ago: number[]) => computeStreak(new Set(ago.map(d)), T)

// [name, days-ago the goal was met, expected]
const cases: [string, number[], { days: number; todayDone: boolean; freezes: number; frozen: number }][] = [
  ['no activity', [], { days: 0, todayDone: false, freezes: 2, frozen: 0 }],
  ['today only', [0], { days: 1, todayDone: true, freezes: 2, frozen: 0 }],
  ['yesterday only: today pending is not a miss', [1], { days: 1, todayDone: false, freezes: 2, frozen: 0 }],
  ['three straight days', [0, 1, 2], { days: 3, todayDone: true, freezes: 2, frozen: 0 }],
  ['one missed day is frozen, not counted', [0, 1, 3, 4], { days: 4, todayDone: true, freezes: 1, frozen: 1 }],
  ['two missed days spend both freezes', [0, 3, 4], { days: 3, todayDone: true, freezes: 0, frozen: 2 }],
  ['three missed days in a row end it', [0, 4, 5], { days: 1, todayDone: true, freezes: 0, frozen: 0 }],
  ['third separate miss with no refill ends it', [0, 2, 4, 6, 7], { days: 1, todayDone: true, freezes: 0, frozen: 0 }],
  ['seven kept days earn one freeze back', [0, 1, 2, 3, 4, 5, 6, 8, 10, 11], { days: 10, todayDone: true, freezes: 1, frozen: 2 }],
  ['gap up to yesterday, today pending, still alive', [3, 4, 5], { days: 3, todayDone: false, freezes: 0, frozen: 2 }],
]
for (const [name, ago, want] of cases) {
  const got = streak(ago)
  const have = { days: got.days, todayDone: got.todayDone, freezes: got.freezes, frozen: got.frozen.length }
  check(`streak: ${name}`, JSON.stringify(have) === JSON.stringify(want), `got ${JSON.stringify(have)} want ${JSON.stringify(want)}`)
}
check('streak: never holds more than 2 freezes', streak(Array.from({ length: 30 }, (_, i) => i)).freezes === 2)

// Tier limits: collections/day, grown notes/day, Ask AI/day.
const lim = (t: string) => {
  const l = limitsFor(t)
  return [l.newCollectionsPerDay, l.newNotesPerDay, l.askAiPerDay].join('/')
}
check('limits: new = 2/6/5', lim('new') === '2/6/5', lim('new'))
check('limits: free = 5/20/10', lim('free') === '5/20/10', lim('free'))
check('limits: pro is unlimited', !Number.isFinite(limitsFor('pro').newNotesPerDay))
check('limits: shared new-account pool = 300', NEW_ACCOUNTS_DAILY_MODEL_CALLS === 300)
check('tier: unapproved is new', tierOf({ accessApproved: false, planTier: 'free' }) === 'new')
check('tier: approved is its plan', tierOf({ accessApproved: true, planTier: 'pro' }) === 'pro')
check('tier: pro wins even unapproved (admin grant)', tierOf({ accessApproved: false, planTier: 'pro' }) === 'pro')
check('tier: max wins even unapproved (admin grant)', tierOf({ accessApproved: false, planTier: 'max' }) === 'max')
check('sources: free and new cannot, pro can once, max can again',
  limitsFor('free').sourcesPerDay === 0 && limitsFor('new').sourcesPerDay === 0 &&
  limitsFor('pro').sourcesPerDay > 0 && !limitsFor('pro').recheckSources &&
  limitsFor('max').sourcesPerDay > 0 && limitsFor('max').recheckSources)

// Model fallback chain.
delete process.env.GEMINI_MODEL
delete process.env.GEMINI_MODELS
check('models: default chain starts at gemini-3.5-flash-lite', configuredChain()[0] === 'gemini-3.5-flash-lite')
check('models: chain has no duplicates', new Set(DEFAULT_MODEL_CHAIN).size === DEFAULT_MODEL_CHAIN.length)
process.env.GEMINI_MODEL = ''
check('models: empty GEMINI_MODEL is ignored, not sent as ""', !configuredChain().includes(''))
process.env.GEMINI_MODEL = 'x-model'
check('models: GEMINI_MODEL goes first', configuredChain()[0] === 'x-model')

console.log(failed ? `\n${failed} FAILED` : '\nall rule checks passed')
process.exit(failed ? 1 : 0)
