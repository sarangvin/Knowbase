# Automated Graph

Every topic note carries structured frontmatter. Per-space dashboards compute the
"Next Up" pick automatically by combining **readiness** (are your prerequisites
confident enough?) and **leverage** (how many other frontier topics does this unlock?),
plus a spaced-review nudge for things you've learned but haven't revisited.

## Frontmatter schema (per topic note)
```yaml
---
space: Economics
status: known | frontier   # known = no longer "next up" material; frontier = candidate
prerequisites:
  - "[[Supply and Demand]]"
importance: 5    # 1-5, how foundational/valuable this is
interest: 5      # 1-5, your current curiosity
confidence: 0    # 0-5, how well YOU know this — drives readiness + review scheduling
last_reviewed: 2026-06-11   # date you last studied/reviewed this; empty if never
---
```

`Templates/Topic Note.md` has this schema pre-filled (plus `## AI Notes` /
`## Useful Links` / `## My Notes` sections) for new topics.

### Confidence — the core signal
- `0` = haven't started · `1` = heard of it · `2` = basic grasp · `3` = solid
  understanding · `4` = can apply it · `5` = could teach it.
- A prerequisite counts as "met" once its `confidence` reaches `confidence_threshold`
  (set per space in `_config.md`, default `3`).
- Topics at or above the threshold but not reviewed in `review_interval_days` show up
  under "Due for review" — this is the spaced-repetition layer.

## Per-space config (`_config.md`)
Each space has its own `_config.md` with the scoring weights:
```yaml
confidence_threshold: 3
weight_importance: 1
weight_unlocks: 2
weight_interest: 0.5
review_interval_days: 30
```
`score = importance * weight_importance + unlocks * weight_unlocks + interest * weight_interest`.
Tune these per space without touching any dataview code.

## Dashboards
- **`<Space>/Next Up.md`** — the ranked "what to learn next" pick for one space, plus
  "Locked" (frontier topics still waiting on a prerequisite) and "Due for review".
- **`Automated Graph/Today.md`** — portfolio view across *all* spaces: top pick per
  space + everything due for review, in one table.

## Setup required
Both dashboards use **Dataview** (community plugin, JS queries enabled — already
installed in this vault under `.obsidian/plugins/dataview/`). If Obsidian was open when
it was installed, reload the vault (Cmd+R) to pick it up.

A no-install partial alternative: `<Space>/Next Up (Bases-only).base` filters/sorts by
`status`/`importance`/`interest` using Obsidian's built-in **Bases** — it can't compute
"unlocks" or confidence-based readiness, so treat it as a fallback only.

## Workflow
1. Add new topics with `status: frontier`, `confidence: 0`, and fill in
   `prerequisites`/`importance`/`interest`.
2. Study the current "Next Up" pick. Jot your own understanding in `## My Notes`.
3. Run the **`sync-knowledge-notes`** skill — it refines `## AI Notes` from what you
   wrote, spins off new topic notes for concepts you mentioned, and bumps
   `confidence`/`last_reviewed`.
4. Rankings recalculate automatically — open `Next Up.md` or `Today.md`.

## Adding a new space
Use the **`new-knowledge-space`** skill — it researches the domain, generates a starter
8-15 topic graph (prerequisites, importance/interest/confidence), `_config.md`, and
`Next Up.md`, calibrated to how much you already know.

## Maintenance
`scripts/lint_graph.py` (run from the `KnowBase` project root) checks every
`prerequisites` link resolves to a real topic note and that the prerequisite graph has
no cycles, across all spaces:
```sh
python3 scripts/lint_graph.py
```
