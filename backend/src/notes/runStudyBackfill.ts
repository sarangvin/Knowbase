// Fill in study material for notes written before it was stored.
//
//   cd backend
//   npx tsx --env-file=.env src/notes/runStudyBackfill.ts --dry                 (count only)
//   npx tsx --env-file=.env src/notes/runStudyBackfill.ts --limit 40            (40 model calls, Flash chain)
//   npx tsx --env-file=.env src/notes/runStudyBackfill.ts --model gemma --limit 500   (12 at once, 27/min per model)
//
// --model gemma runs on the Gemma models only: they are slow (~30s a call)
// but have their own quota, so a large backfill does not eat the Flash-Lite
// requests that onboarding and Ask AI share. Hence the longer deadline and
// the parallel calls, spread over both Gemma models (30 requests a minute
// each on AI Studio's free tier).
//
// Safe to run repeatedly; copies from identical notes are free and unlimited,
// model calls are capped by --limit and by the daily budget.
import { backfillStudy } from './studyBackfill.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback
}

const model = (() => {
  const i = args.indexOf('--model')
  return i >= 0 ? args[i + 1] : undefined
})()
const GEMMA = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it']
const models = model === 'gemma' ? GEMMA : model ? [model] : undefined

const result = await backfillStudy({
  limit: num('limit', 40),
  // Gemma's daily quota is far larger than Flash-Lite's 500, and the budget
  // only counts the models in use.
  dailyCallBudget: num('budget', models ? 5000 : 700),
  pauseMs: num('pause', models ? 1000 : 4500),
  timeoutMs: models ? num('timeout', 300_000) : undefined,
  concurrency: num('concurrency', models ? 12 : 1),
  // AI Studio allows Gemma 30 requests a minute per model; a little under.
  perModelRpm: models ? num('rpm', 27) : undefined,
  models,
  dryRun: flag('dry'),
})
console.log(JSON.stringify(result, null, 2))
process.exit(0)
