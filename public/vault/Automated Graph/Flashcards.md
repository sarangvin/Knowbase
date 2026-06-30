# Flashcards — across all spaces

Active-recall queue: topics ranked by **how long ago they were reviewed** and **how low their confidence is**, across every knowledge space. This is the candidate list the `flashcards` skill draws from when you ask to be quizzed — it doesn't ask questions itself (Dataview can't grade free-text answers), but it shows you what's most overdue for a check.

Run **"quiz me"** / **"flashcards me on Economics"** / **"test my knowledge"** to start a session: Claude will pick from the top of this list, ask you a question per topic, evaluate your answer, and adjust `confidence` / `last_reviewed` accordingly.

```dataviewjs
const allTopics = dv.pages('"Automated Graph"').where(p => p.file.folder.split("/").includes("Topics"));

function toMillis(d) {
  if (!d) return null;
  if (typeof d.toMillis === "function") return d.toMillis();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

const candidates = allTopics
  .where(p => (p.confidence ?? 0) > 0)
  .map(p => {
    const space = p.file.folder.split("/")[1];
    const lastMs = toMillis(p.last_reviewed);
    const daysSince = lastMs === null ? Infinity : Math.floor((Date.now() - lastMs) / 86400000);
    return { page: p, space, daysSince, confidence: p.confidence ?? 0 };
  })
  .array();

// Primary: longest since reviewed first. Secondary: lowest confidence first.
candidates.sort((a, b) => {
  if (b.daysSince !== a.daysSince) return b.daysSince - a.daysSince;
  return a.confidence - b.confidence;
});

const top = candidates.slice(0, 10);

dv.header(3, "Flashcard queue (top 10)");
if (top.length) {
  dv.table(
    ["Space", "Topic", "Confidence", "Last reviewed", "Days since"],
    top.map(c => [
      c.space,
      c.page.file.link,
      `${c.confidence}/5`,
      c.page.last_reviewed ?? "never",
      c.daysSince === Infinity ? "never" : c.daysSince
    ])
  );
} else {
  dv.paragraph("No topics with confidence > 0 yet — nothing to quiz on until you've started learning something.");
}
```

## How the queue is built
- Only topics with `confidence > 0` are eligible (no point quizzing on something never touched).
- Ranked by `last_reviewed` age first (never-reviewed counts as "infinitely" overdue), then by `confidence` ascending as a tiebreak — so the most stale *and* least solid knowledge surfaces first.
- This queue is informational only. The actual question-asking, answer-grading, and `confidence`/`last_reviewed` updates happen via the `flashcards` skill — see [[knowbase]] for details.
