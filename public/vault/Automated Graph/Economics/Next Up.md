# Next Up — Economics

Requires the Dataview plugin (with JavaScript queries enabled). Tunable parameters live in [[_config]].

```dataviewjs
const TOPICS_FOLDER = '"Automated Graph/Economics/Topics"';

const config = dv.page("Automated Graph/Economics/_config") ?? {};
const CONF_THRESHOLD = config.confidence_threshold ?? 3;
const W_IMPORTANCE = config.weight_importance ?? 1;
const W_UNLOCKS = config.weight_unlocks ?? 2;
const W_INTEREST = config.weight_interest ?? 0.5;
const REVIEW_DAYS = config.review_interval_days ?? 30;

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

function confidenceOf(path) {
  return pageByPath.get(path)?.confidence ?? 0;
}

function isReady(p) {
  return prereqPaths(p).every(path => confidenceOf(path) >= CONF_THRESHOLD);
}

function unlockCount(p) {
  return frontier.where(f => prereqPaths(f).includes(p.file.path)).length;
}

const ranked = frontier
  .where(isReady)
  .map(p => {
    const unlocks = unlockCount(p);
    const score = (p.importance ?? 0) * W_IMPORTANCE + unlocks * W_UNLOCKS + (p.interest ?? 0) * W_INTEREST;
    return { page: p, unlocks, score };
  })
  .sort(c => c.score, 'desc');

if (ranked.length) {
  const top = ranked[0];
  dv.header(3, "Pick: " + top.page.file.link);
  dv.paragraph(`Score **${top.score.toFixed(1)}** — importance ${top.page.importance}, unlocks ${top.unlocks} other topic(s), interest ${top.page.interest}, confidence ${top.page.confidence ?? 0}/5 (prerequisites need >= ${CONF_THRESHOLD}/5, met).`);
} else {
  dv.paragraph("No frontier topics are ready yet — raise confidence on a prerequisite (study it, then update its `confidence`), or lower `confidence_threshold` in `_config.md`.");
}

dv.header(4, "Frontier (ready now)");
dv.table(
  ["Topic", "Confidence", "Importance", "Unlocks", "Interest", "Score"],
  ranked.array().map(c => [c.page.file.link, `${c.page.confidence ?? 0}/5`, c.page.importance, c.unlocks, c.page.interest, c.score.toFixed(1)])
);

const notReady = frontier.where(p => !isReady(p));
if (notReady.length) {
  dv.header(4, "Locked (prerequisites not yet confident enough)");
  dv.table(
    ["Topic", "Needs"],
    notReady.array().map(p => [
      p.file.link,
      prereqPaths(p)
        .filter(path => confidenceOf(path) < CONF_THRESHOLD)
        .map(path => pageByPath.get(path)?.file?.link ?? path)
        .join(", ")
    ])
  );
}

const reviewDue = pages
  .where(p => (p.confidence ?? 0) >= CONF_THRESHOLD)
  .map(p => {
    const lastMs = toMillis(p.last_reviewed);
    const daysSince = lastMs === null ? null : Math.floor((Date.now() - lastMs) / 86400000);
    return { page: p, daysSince };
  })
  .where(c => c.daysSince === null || c.daysSince >= REVIEW_DAYS)
  .sort(c => (c.daysSince ?? Infinity), 'desc');

if (reviewDue.length) {
  dv.header(4, "Due for review");
  dv.table(
    ["Topic", "Confidence", "Last reviewed", "Days since"],
    reviewDue.array().map(c => [
      c.page.file.link,
      `${c.page.confidence ?? 0}/5`,
      c.page.last_reviewed ?? "never",
      c.daysSince ?? "—"
    ])
  );
}
```

## How this works
- **Confidence** (0-5, set on each topic note) is the source of truth for "how well do I know this". A prerequisite is considered *met* once its confidence reaches `confidence_threshold` in [[_config]].
- **Frontier (ready now)** — topics whose prerequisites are met, ranked by `score = importance * weight_importance + unlocks * weight_unlocks + interest * weight_interest`. Leverage (unlocks) is weighted highest by default.
- **Locked** — frontier topics still waiting on a prerequisite to reach the confidence threshold.
- **Due for review** — topics you've already learned (confidence >= threshold) that haven't been touched in `review_interval_days`. Update `last_reviewed` (and re-confirm/adjust `confidence`) after you review one.

To progress a topic: study it, update its `confidence` and `last_reviewed` in frontmatter (the `sync-knowledge-notes` skill can help do this from your "My Notes"), and the rankings recalculate automatically.
