# Hidden buffer flow

**Two shelves, not one.** A collection keeps three unfinished notes the
reader can see, and three more that are fully generated and invisible.
Finishing a visible note hands over the best of the hidden three — instantly,
with no model call — and generation starts in the background to replace what
was taken.

---

## Why

Growth used to begin when the shelf ran low, which meant the note you were
promised next did not exist yet. A plan call, then a draft, tens of seconds
each, and in the meantime Next Up showed a "Coming soon" row you cannot
click. The latency was real and it landed exactly where the reader was
standing: the moment they finished something and asked for more.

The buffer does not make generation faster. It moves it off that path. The
note revealed when you finish one was written minutes ago.

---

## Trigger

| Step | Where | Cost |
|---|---|---|
| Reader marks a note reviewed | `src/features/reader/ReviewBar.tsx` | — |
| `POST /api/onboarding/grow` | `backend/src/routes/onboarding.ts` | — |
| **Reveal**, before the response | `vault/hidden.ts` → `revealUpTo` | one `UPDATE` |
| Top the buffer back up, under `waitUntil` | `onboarding/grow.ts` → `growSpace` | a plan call |
| Draft the new hidden notes | the draft queue, drained by the status poll | a draft call each |

The reveal is **inside the request**, before the response, because it is a
single update against a note that already exists. The model call that
replaces what was taken happens afterwards with nobody watching. That split
is the whole point.

The revealed note reaches the open app through `refreshVault` — see
**The vault fills in while they watch** in [onboarding.md](onboarding.md).

---

## What "hidden" means

`hidden: true` in the note's own frontmatter.

**A frontmatter flag rather than a table**, like `pending` and `archived`
before it. Everything else about a note lives in the note; a second place to
look for "does this exist for the reader" is a second place to get it wrong.
Exported to Obsidian, a hidden note is a note with a flag in it, not a
dangling reference to a row that did not come with it.

**The server does not serve it.** `NOT_HIDDEN` is applied in
`GET /api/vaults/mine/notes` *and* in `GET /api/vaults/mine/note?path=`, and
in the quiz and flashcard builders. Not in the client's dashboards: a note
the browser receives and agrees not to draw is one search box, one graph view
or one export away from being drawn, and the path is a query parameter that
is not hard to guess. This project has already learned once that a hidden
control is not a rule.

On reveal the flag comes out and `revealed: YYYY-MM-DD` goes in. That date is
what the reader's **New** chip is drawn from — the anticipation beat the
buffer pays for. Without it, finishing a note just makes the list silently
one longer. The chip clears itself when the note is reviewed, which needs no
timer and no second write.

---

## The two numbers

`VISIBLE_AHEAD = 3`, `HIDDEN_BUFFER = 3`, both in `backend/src/vault/hidden.ts`.

Three visible keeps a next step always available without turning the sidebar
into a backlog nobody will finish. Three hidden is one reveal per completion
with two spare, so the buffer survives a couple of failed generations without
the reader ever seeing an empty shelf.

`wanted(visible, hidden)` in `grow.ts` decides how many to generate, and it
counts **both** shortfalls. A reader who has just finished a note has one gap
on the visible shelf that a reveal is about to fill from the hidden one — so
the hidden shelf is two short, not one. Generating only for the gap you can
see drains the buffer by one per note finished until it is empty.

| visible | hidden | want |
|---|---|---|
| 3 | 3 | 0 |
| 2 | 3 | 1 |
| 1 | 2 | 3 |
| 3 | 0 | 3 |
| 5 | 0 | 3 |
| 0 | 0 | 6 |

Capped at `MAX_PER_RUN = 3` per run.

---

## Which hidden note is revealed

`rankForReveal`, ordered: **ready**, then **written**, then **score**.

`score = importance × w + unlocks × w + interest × w`, weights from the
space's `_config.md`.

**This mirrors `computeNextUp` in `src/features/automated-graph/engine.ts`.**
It is the one rule in the buffer that exists twice — the workspaces do not
share a build, which is also why `frontmatter.ts` does — and the two must be
changed together. A reveal that disagreed with the ranking on screen would
hand the reader a note the page had just told them was not the best one.

Readiness is first and is not part of the score: a note whose prerequisites
are unreviewed lands in "Locked", where the reader cannot open it, so
revealing it would spend the buffer on nothing.

---

## Why `revealUpTo` and not `revealOne`

Usually it reveals exactly one, because the shelf is one short. But the gap
is not always one, and a fixed one-per-review has a deadlock in it: a
collection whose last few generations failed — or one carried over from
before the buffer existed — can sit with an **empty shelf and three notes
waiting behind it**. The reader has nothing to complete, so nothing triggers
a reveal, so the shelf stays empty forever.

The condition is the shelf being short, not the review. Three callers ask:

- `POST /grow`, when a note is finished
- `growSpace`, after it writes new hidden notes — the first thing a starved
  collection has had to offer
- the ten-minute cron, before it spends anything, for people who are not in
  the app at all

---

## Invariants

- **A hidden note never reaches the client.** Enforced in SQL, in four
  places, not in the UI.
- **Reveal spends nothing.** It is an `UPDATE`. If it ever needs a model
  call, the buffer has failed at its only job.
- **Reveal is guarded on the row still being hidden** (`IS_HIDDEN` in the
  `WHERE`), so a review and the cron landing together cannot both count the
  same note.
- **Generation always writes hidden.** A note that appeared on the shelf the
  moment it was planned would be a "Coming soon" row again.
- **Hidden notes are counted out of "unreviewed" everywhere**, including the
  cron's candidate query. Counting them as available would tell the top-up
  that every collection was stocked the moment the buffer filled, and it
  would quietly stop doing anything.

---

## Known gaps

- **Collections that predate this have no buffer.** They fill on the first
  grow — `wanted(5, 0) = 3` — so the first review after deploying spends
  three calls instead of one. Self-healing, but not free.
- **The corpus still receives notes on write**, hidden or not. That is
  deliberate: a hidden note is a real note and the next person to adopt the
  space should get it. It does mean the corpus carries topics no reader has
  been shown yet.
- **The score is duplicated** between `hidden.ts` and `engine.ts`. Named
  here, and in both files, because the build layout is what forces it.
