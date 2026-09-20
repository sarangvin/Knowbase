# Review flow

**Closing the loop on a note.** You finish reading a topic, say so, and three
things follow: the note's confidence rises, Next Up moves on, and the server
grows the tree behind you.

This is the flow that turns a pile of generated notes into a study system, so
it is also the flow where a disagreement between two components is most
visible — the app telling you to study something and then refusing to let you
finish it.

---

## Trigger

One action, two shapes, chosen by `(hover: none) and (pointer: coarse)` —
a live media query in `src/features/reader/ReviewBar.tsx`. A laptop with a
touchscreen reports `coarse` too and should get the button, so the absence of
hover is the half that decides.

| Device | Control | Why |
|---|---|---|
| Pointer | "Mark reviewed" button at the end of the note | A mouse can aim. Pushing a wheel against a threshold is a gesture borrowed from a device that is not there |
| Touch | An orange sheet that grows as you swipe up past the end | Growth under the thumb is the feedback; effort replaces aim |

The sheet only exists at the very bottom of the note. Elsewhere it is a bar
covering text with an instruction you cannot act on.

The gesture lives in `src/features/reader/useScrollReview.ts`:

- **Touch** — pull-to-refresh, inverted. Distance past the end, *held* while
  the finger is down, springing back on an early release. 110px fills it.
- **Wheel** — no hold exists, so progress accumulates from delta (380px) and
  decays in ~0.5s. **A wheel gesture only counts if it starts at the bottom**,
  or a hard flick to the end of a note would mark it reviewed on its own
  momentum. Disabled entirely on pointer devices.
- Both commit at 1, on the way up, never on release.

---

## Steps

1. `run()` in `ReviewBar.tsx` re-reads the note from the store — a background
   draft may have rewritten it since it was displayed.
2. `setFrontmatterValue(raw, 'last_reviewed', localDay())`.
3. `confidence + 1`, capped at 5.
4. `status: 'known'` if confidence has reached the space's
   `confidence_threshold` (default 3, from `_config`). Note this no longer
   gates anything in the graph — prerequisites unlock on *review*, not
   confidence — it records that a topic is learned.
5. Save. If nothing changed, no write — that state is the system already
   being right, not an error.
6. `requestSpaceGrowth(space)` → `POST /api/onboarding/grow`, fire and forget.
   The review is already saved; a failure here cannot surface.
7. The control shows "Review complete" for 1s, then goes — permanently for
   today, because of the daily cap.

### Growth, server side

`backend/src/onboarding/grow.ts` — `growSpace(userId, space)`. Never throws;
its only caller is a fire-and-forget request behind an action that already
succeeded.

- "Studied" is **`last_reviewed` being set**, not confidence — a slider can be
  dragged without reading anything.
- If fewer than `MAX_UNREVIEWED` (**3**) topics are unstudied, generate more,
  at most `MAX_PER_RUN` (**3**) per run.
- New topics are written as placeholders and their bodies **queued**, not
  drafted inline. See below.

The cap is the point. Topping back up to three keeps a next step always
available without turning the sidebar into a backlog nobody will finish.

### The draft queue

`backend/src/onboarding/queue.ts`, table `draft_queue`.

Drafting used to run inline in whichever request asked for it, so the work
existed only as long as that invocation did. Overrun the 60s limit or get
killed and the note stayed a one-line placeholder with nothing, anywhere,
that knew to retry. Three notes in one user's vault sat like that for a day.

| | |
|---|---|
| **Enqueued by** | `growSpace`, and `reconcileQueue` for anything stranded |
| **Claimed by** | one `UPDATE … FOR UPDATE SKIP LOCKED` statement, so overlapping drains take different rows rather than drafting the same note twice |
| **Driven by** | `GET /api/onboarding/status` — the banner already polls it every 5s, which makes it the heartbeat. There is no long-running worker to put this on |
| **Retried** | up to `MAX_ATTEMPTS` (3); a `running` row older than 5 minutes is reclaimed as dead |
| **Swept by** | `POST /api/onboarding/queue/sweep` — scans notes for placeholders no job is tracking |
| **Visible in** | admin › Model usage, as pending / in flight / given up on |

Each write re-checks that the note is still a placeholder, immediately before
committing: a draft call takes seconds, and the user may have opened and
edited the note during them. Their text always wins.

Onboarding does **not** use the queue — it drafts all five notes before
declaring the space ready, which is a deliberate product decision (see
[onboarding.md](onboarding.md)).

### "Coming soon"

A placeholder carries `pending: true` in its frontmatter, and Next Up renders
a "Coming soon" chip beside the title. `fillPlaceholder` removes the flag in
the same write that puts the body in, so the chip disappears on its own.

The flag exists rather than the client sniffing for the placeholder sentence:
that string is prose, it will be reworded, and a UI that breaks when prose
changes is exactly the coupling the rest of this document is about.

---

## What it writes

Frontmatter on one note: `last_reviewed`, `confidence`, and `status` at the
threshold. Then, indirectly, new `notes` rows from `growSpace`, and
`usage_events` for the drafts.

---

## Invariants

- **One review per note per day.** Spacing is the mechanism; letting
  confidence be walked to 5 in one sitting would make the ranking describe an
  afternoon's enthusiasm rather than what stuck. Enforced in `ReviewBar` — it
  renders nothing at all once `last_reviewed` is today, except during the 1s
  hold of a review just made.
- **Dates are local, never `toISOString()`.** The vault stores plain
  `YYYY-MM-DD`; UTC would stamp tomorrow for anyone east of Greenwich
  reviewing in the evening.
- **One definition of "reviewed today".** `localDay`, `lastReviewedDay` and
  `isReviewedToday` live in `features/automated-graph/engine.ts` and are
  imported by the reader. They were duplicated once, and that is exactly what
  broke this flow.
- **Never recommend what cannot be acted on.** The Next Up pick skips
  anything already reviewed today. An empty pick is the honest answer.
- **A prerequisite is met once it has been reviewed**, not once it has been
  mastered. Gating on confidence made the graph a ladder you could climb only
  three reviews per rung, and confidence is self-reported — it measured how
  generous someone felt rather than what they had covered. Having read the
  groundwork earns the right to read on; how well it stuck is the review
  list's job.
- **The gesture always has a keyboard equivalent.** The sheet is a real
  `<button>`; a gesture with no equivalent control is an action some users
  simply cannot perform.

---

## How Next Up reads the result

`computeNextUp` in `engine.ts`. Three lists, split on one question — **does
this note have a `last_reviewed` date?** Each topic appears in exactly one.

| List | Contents | Order |
|---|---|---|
| **New topics (ready now)** | Never opened, prerequisites met | `importance×1 + unlocks×2 + interest×0.5` |
| **Locked** | Never opened, a prerequisite not yet reviewed | — |
| **Review** | Everything opened at least once, any confidence | interest desc, then confidence asc, then oldest `last_reviewed` |

The **pick** is the top new topic, falling back to the top review item not
already done today.

The review order is a lexicographic sort, not a blended score, because the
order has to be explainable from the columns on screen.

---

## Known gaps

- **`## Questions` is dead.** Generated questions are written as `- bullets`
  (`notePlan.ts`), but every consumer that acts on questions looks for `Q:`
  blocks — `unansweredQuestions` in `features/sync/sync.ts` splits on
  `/\n(?=Q\s*:)/`. So Sync reports "nothing to sync" on a note full of
  questions. Ask AI writes the correct `Q:`/`A:` shape, so hand-made
  questions work and generated ones never have. The quiz reads both shapes
  (`quiz/build.ts` → `questionsOf`) and therefore works; Sync is the one
  left behind, and the fix is to read the same way.
- **`status: 'known'` is only written going up.** Lowering confidence below
  the threshold by hand leaves `status: known` behind.
