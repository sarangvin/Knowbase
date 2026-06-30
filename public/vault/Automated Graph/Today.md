# Today — across all spaces

A portfolio view: the top 3 "Next Up" picks per knowledge space, plus anything due for review. Open this first; drill into a space's own `Next Up.md` for the full ranked list.

```dataviewjs
const allTopics = dv.pages('"Automated Graph"').where(p => p.file.folder.split("/").includes("Topics"));

const spaces = {};
for (const p of allTopics) {
  const space = p.file.folder.split("/")[1];
  (spaces[space] ??= []).push(p);
}

function toMillis(d) {
  if (!d) return null;
  if (typeof d.toMillis === "function") return d.toMillis();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

const picks = [];
const reviews = [];

for (const [space, pages] of Object.entries(spaces)) {
  const config = dv.page(`Automated Graph/${space}/_config`) ?? {};
  const CONF_THRESHOLD = config.confidence_threshold ?? 3;
  const W_IMPORTANCE = config.weight_importance ?? 1;
  const W_UNLOCKS = config.weight_unlocks ?? 2;
  const W_INTEREST = config.weight_interest ?? 0.5;
  const REVIEW_DAYS = config.review_interval_days ?? 30;

  const pageByPath = new Map(pages.map(p => [p.file.path, p]));
  const frontier = pages.filter(p => p.status === "frontier");

  const prereqPaths = p => (p.prerequisites ?? []).map(pr => pr.path);
  const confidenceOf = path => pageByPath.get(path)?.confidence ?? 0;
  const isReady = p => prereqPaths(p).every(path => confidenceOf(path) >= CONF_THRESHOLD);
  const unlockCount = p => frontier.filter(f => prereqPaths(f).includes(p.file.path)).length;

  const ranked = frontier
    .filter(isReady)
    .map(p => {
      const unlocks = unlockCount(p);
      const score = (p.importance ?? 0) * W_IMPORTANCE + unlocks * W_UNLOCKS + (p.interest ?? 0) * W_INTEREST;
      return { page: p, score };
    })
    .sort((a, b) => b.score - a.score);

  if (ranked.length) {
    ranked.slice(0, 3).forEach((c, i) => {
      picks.push([space, i + 1, c.page.file.link, c.score.toFixed(1), `${c.page.confidence ?? 0}/5`]);
    });
  } else if (frontier.length) {
    picks.push([space, "—", "*(nothing ready — see space's Next Up)*", "—", "—"]);
  }

  for (const p of pages) {
    if ((p.confidence ?? 0) >= CONF_THRESHOLD) {
      const lastMs = toMillis(p.last_reviewed);
      const daysSince = lastMs === null ? null : Math.floor((Date.now() - lastMs) / 86400000);
      if (daysSince === null || daysSince >= REVIEW_DAYS) {
        reviews.push([space, p.file.link, `${p.confidence ?? 0}/5`, daysSince ?? "never"]);
      }
    }
  }
}

dv.header(3, "Next Up, by space");
if (picks.length) {
  dv.table(["Space", "Rank", "Topic", "Score", "Confidence"], picks);
} else {
  dv.paragraph("No spaces with a ready frontier topic yet.");
}

dv.header(3, "Due for review");
if (reviews.length) {
  dv.table(["Space", "Topic", "Confidence", "Days since review"], reviews);
} else {
  dv.paragraph("Nothing due for review.");
}
```

## How spaces are discovered
Any folder `Automated Graph/<Space>/Topics/` with notes following the [[Topic Note]] schema is picked up automatically — including its own `_config.md` weights. To add a new space, use the `new-knowledge-space` skill or copy the `Economics` folder structure.


