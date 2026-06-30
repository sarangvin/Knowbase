---
confidence_threshold: 3
weight_importance: 1
weight_unlocks: 2
weight_interest: 0.5
review_interval_days: 30
---

# Config — Economics

Tunable parameters read by `Next Up.md` for this space. Edit the frontmatter above — no need to touch the dataview script.

- **confidence_threshold** (0-5): how confident you need to be in a topic for it to count as a *met prerequisite* for something else. Lower this if you want to move faster (less mastery required before unlocking the next topic); raise it if you want to be more rigorous.
- **weight_importance**: how much a topic's `importance` (1-5) contributes to its "Next Up" score.
- **weight_unlocks**: how much it matters that a topic unlocks *other* frontier topics (leverage). This is weighted highest by default — picking foundational topics first compounds.
- **weight_interest**: how much your current curiosity (`interest`, 1-5) contributes. Raise this if you want the system to favor what you *feel* like learning over what's "optimal".
- **review_interval_days**: once a topic's `confidence` is at or above the threshold, how many days can pass before it's flagged "due for review" on the Today/Next Up dashboards.

`score = importance * weight_importance + unlocks * weight_unlocks + interest * weight_interest`
