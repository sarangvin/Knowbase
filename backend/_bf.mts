import { backfillAnswers, countUnanswered } from '/Users/sarang/Codies/knowbase-web/backend/src/notes/backfill.js'
const kind = (process.env.KIND ?? 'personal') as 'personal' | 'global'
const before = await countUnanswered(kind)
const t0 = Date.now()
const res = await backfillAnswers({
  vaultKind: kind,
  limit: Number(process.env.LIMIT ?? 20),
  dailyCallBudget: 430,
  pauseMs: 4500,
  budgetMs: 9 * 60 * 1000,
})
const after = await countUnanswered(kind)
console.log(`${kind}: ${JSON.stringify(res)}  in ${Math.round((Date.now()-t0)/1000)}s`)
console.log(`  remaining: ${before.notes} -> ${after.notes} notes, ${before.questions} -> ${after.questions} questions`)
process.exit(0)
