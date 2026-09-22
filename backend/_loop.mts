import { backfillAnswers, countUnanswered } from '/Users/sarang/Codies/knowbase-web/backend/src/notes/backfill.js'

for (const kind of ['personal', 'global'] as const) {
  for (let pass = 1; pass <= 8; pass++) {
    const before = await countUnanswered(kind)
    if (before.notes === 0) { console.log(`${kind}: nothing left`); break }
    const res = await backfillAnswers({
      vaultKind: kind, limit: 40, dailyCallBudget: 430, pauseMs: 4000, budgetMs: 8 * 60 * 1000,
    })
    const after = await countUnanswered(kind)
    console.log(`${kind} pass ${pass}: ${JSON.stringify(res)} | notes ${before.notes} -> ${after.notes}, questions ${before.questions} -> ${after.questions}`)
    if (res.stoppedBecause === 'quota') { console.log('stopping: daily quota guard'); process.exit(0) }
    if (after.notes === 0) break
  }
}
console.log('done')
process.exit(0)
