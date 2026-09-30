---
confidence_threshold: 3
weight_unlocks: 2
weight_interest: 1
review_interval_days: 30
---

# Config — Economics

Tunable parameters read by `Next Up.md` for this space. Edit the frontmatter above — no need to touch the dataview script.

- **confidence_threshold** (0-5): how confident you need to be in a topic for it to count as a *met prerequisite* for something else. Lower this if you want to move faster (less mastery required before unlocking the next topic); raise it if you want to be more rigorous.
- **weight_unlocks**: how much it matters that a topic unlocks *other* frontier topics (leverage). This is weighted highest by default — picking foundational topics first compounds.
- **weight_interest**: how much `interest` (1-5) contributes. It starts as a guess and becomes yours when you finish a topic: swipe right for more like it (5), left for not (1). Raise this if you want the system to favor what you *feel* like learning over what's "optimal".
- **review_interval_days**: once a topic's `confidence` is at or above the threshold, how many days can pass before it's flagged "due for review" on the Today/Next Up dashboards.

`score = unlocks * weight_unlocks + interest * weight_interest`
