# Next Up — Economics

```dataviewjs
const TOPICS_FOLDER = '"Automated Graph/Economics/Topics"';

const config = dv.page("Automated Graph/Economics/_config") ?? {};
const W_IMPORTANCE = config.weight_importance ?? 1;
const W_UNLOCKS = config.weight_unlocks ?? 2;
const W_INTEREST = config.weight_interest ?? 0.5;

const pages = dv.pages(TOPICS_FOLDER);
const pageByPath = new Map(pages.array().map(p => [p.file.path, p]));
const frontier = pages.where(p => p.status === "frontier");

function toMillis(d) {
  if (!d) return null;
  if (typeof d.toMillis === "function") return d.toMillis();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function prereqPaths(p) {
  return (p.prerequisites ?? []).map(pr => pr.path);
}

function isReviewedPath(path) {
  return !!pageByPath.get(path)?.last_reviewed;
}

// A prerequisite is met once it has been read, not once it has been
// mastered — how well it stuck is what the review list below is for.
function isReady(p) {
  return prereqPaths(p).every(isReviewedPath);
}

function unlockCount(p) {
  return frontier.where(f => prereqPaths(f).includes(p.file.path)).length;
}

const ranked = frontier
  .where(p => isReady(p) && !p.last_reviewed)
  .map(p => {
    const unlocks = unlockCount(p);
    const score = (p.importance ?? 0) * W_IMPORTANCE + unlocks * W_UNLOCKS + (p.interest ?? 0) * W_INTEREST;
    return { page: p, unlocks, score };
  })
  .sort(c => c.score, 'desc');

if (ranked.length) {
  const top = ranked[0];
  dv.header(3, "Pick: " + top.page.file.link);
  dv.paragraph(`Score **${top.score.toFixed(1)}** — importance ${top.page.importance}, unlocks ${top.unlocks} other topic(s), interest ${top.page.interest}.`);
} else {
  dv.paragraph("No new topics are ready — either every unlocked topic has been opened already (see Review below), or a prerequisite has not been reviewed yet.");
}

dv.header(4, "New topics (ready now)");
dv.table(
  ["Topic", "Confidence", "Importance", "Unlocks", "Interest", "Score"],
  ranked.array().map(c => [c.page.file.link, `${c.page.confidence ?? 0}/5`, c.page.importance, c.unlocks, c.page.interest, c.score.toFixed(1)])
);

const notReady = frontier.where(p => !isReady(p) && !p.last_reviewed);
if (notReady.length) {
  dv.header(4, "Locked (prerequisites not yet reviewed)");
  dv.table(
    ["Topic", "Needs"],
    notReady.array().map(p => [
      p.file.link,
      prereqPaths(p)
        .filter(path => !isReviewedPath(path))
        .map(path => pageByPath.get(path)?.file?.link ?? path)
        .join(", ")
    ])
  );
}

// Everything opened at least once, whatever its confidence. Want-to-know
// first, then least-known, then longest-neglected.
const review = pages
  .where(p => !!p.last_reviewed)
  .array()
  .map(p => {
    const lastMs = toMillis(p.last_reviewed);
    return { page: p, daysSince: lastMs === null ? null : Math.floor((Date.now() - lastMs) / 86400000) };
  })
  .sort((a, b) =>
    (b.page.interest ?? 0) - (a.page.interest ?? 0) ||
    (a.page.confidence ?? 0) - (b.page.confidence ?? 0) ||
    String(a.page.last_reviewed).localeCompare(String(b.page.last_reviewed))
  );

if (review.length) {
  dv.header(4, "Review");
  dv.table(
    ["Topic", "Interest", "Confidence", "Last reviewed", "Days since"],
    review.map(c => [
      c.page.file.link,
      c.page.interest ?? 0,
      `${c.page.confidence ?? 0}/5`,
      c.page.last_reviewed ?? "never",
      c.daysSince ?? "—"
    ])
  );
}
```

## How this works
- **A prerequisite is met once you have reviewed it**, not once you have mastered it. Having read the groundwork is what earns you the right to read on; how well it stuck is what the review list is for. **Confidence** (0-5) still records that, and reaching `confidence_threshold` in [[_config]] is what flips a topic to `status: known`.
- **New topics (ready now)** — topics you have never opened, whose prerequisites are met, ranked by `score = importance * weight_importance + unlocks * weight_unlocks + interest * weight_interest`. Leverage (unlocks) is weighted highest by default.
- **Locked** — new topics still waiting on a prerequisite to reach the confidence threshold.
- **Review** — every topic you have opened at least once, whatever its confidence, ordered by interest first, then lowest confidence, then longest since last reviewed.

Each topic appears in exactly one of the three, and the split is on one question: does it have a `last_reviewed` date? A topic can be reviewed once a day; the pick skips anything already done today.

To progress a topic: study it, update its `confidence` and `last_reviewed` in frontmatter, and the rankings recalculate automatically.

Thresholds and weights are tunable in [[_config]]. Exported to Obsidian, the block above needs the Dataview plugin with JavaScript queries enabled; here it is rendered natively. Both implement the same rules.
