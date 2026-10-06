// Fill in study material for notes written before it was stored.
//
//   cd backend
//   npx tsx --env-file=.env src/notes/runStudyBackfill.ts --dry          (count only)
//   npx tsx --env-file=.env src/notes/runStudyBackfill.ts --limit 40     (do 40 model calls)
//
// Safe to run repeatedly; copies from identical notes are free and unlimited,
// model calls are capped by --limit and by the shared daily budget.
import { backfillStudy } from './studyBackfill.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback
}

const result = await backfillStudy({
  limit: num('limit', 40),
  dailyCallBudget: num('budget', 700),
  pauseMs: num('pause', 4500),
  dryRun: flag('dry'),
})
console.log(JSON.stringify(result, null, 2))
process.exit(0)
