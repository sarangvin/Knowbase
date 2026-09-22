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
| Touch | An orange sheet ("Swipe up to complete") that grows as you swipe up past the end | Growth under the thumb is the feedback; effort replaces aim |

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

1. The gesture (or the button) opens `ReviewDialog` — it writes nothing by
   itself. Three rows of taps: confidence 0-5, importance and interest 1-5,
   pre-filled from the note so an untouched row keeps its value.
2. On submit, `ReviewBar.tsx` re-reads the note from the store — a background
   draft may have rewritten it since it was displayed.
3. `last_reviewed` = `localDay()`, and all three scores as given.
4. `status` follows confidence **in both directions** against the space's
   `confidence_threshold` (default 3, from `_config`). It no longer gates
   anything in the graph — prerequisites unlock on *review*, not confidence
   — but it is what a reader sees and what an exported Obsidian vault sorts
   by.
5. Save. If nothing changed, no write — that state is the system already
   being right, not an error.
6. `requestSpaceGrowth(space)` → `POST /api/onboarding/grow`, fire and forget.
   The review is already saved; a failure here cannot surface.
7. Open `Automated Graph/<space>/Next Up.md`. The note is finished; leaving
   someone at the bottom of it with nothing to do makes them find their own
   way out.

Cancelling writes nothing, and the gesture stays usable — the daily cap
counts reviews, not attempts.

### Growth, server side

`backend/src/onboarding/grow.ts` — `growSpace(userId, space)`. Never throws;
its only caller is a fire-and-forget request behind an action that already
succeeded.

- An **archived** collection does not grow. Spending model calls filling a
  shelf somebody just closed, and putting "Coming soon" notes into a space
  that is not on screen, are both answers to a question they did not ask.
- "Studied" is **`last_reviewed` being set**, not confidence — a slider can be
  dragged without reading anything.
- If fewer than `MAX_UNREVIEWED` (**3**) topics are unstudied, generate more,
  at most `MAX_PER_RUN` (**3**) per run. So a collection sitting at three
  unreviewed topics is *correctly* not growing — that is the cap working,
  not a failure, and it is the first thing to check when "nothing is
  generating".
- **The plan call retries after a timeout**, unlike onboarding's. That
  break assumed whatever made the model slow would still be true a second
  later. Measured, it is not: consecutive calls with the same prompt came
  back in 1.6s, 2.6s, 8s, 10s, 16s and 20s+, so about one in four hit the
  20s deadline and a retry almost always succeeded — 12 of 12 with the
  retry, against 3 of 4 without. Growth can afford the second attempt where
  onboarding cannot: nobody is waiting on it, and `/grow` hands `drainQueue`
  an absolute deadline, so two slow attempts simply leave the draft for the
  next poll.
- **A failed generation writes a `usage_event`.** Growth runs behind a
  fire-and-forget request with nobody watching, so when it silently did
  nothing the only trace was a `console.warn` in a serverless log. The row
  is what makes "why is nothing generating" answerable from the database.
- New topics are written as placeholders and their bodies **queued**, not
  drafted inline. See below.

The cap is the point. Topping back up to three keeps a next step always
available without turning the sidebar into a backlog nobody will finish.

### The scheduled top-up

`onboarding/topUp.ts`, behind `GET /api/cron/top-up`, on a Vercel cron every
ten minutes.

Growth on review works while you are in the app and fails everywhere else:
the request is fire-and-forget, so a timeout, a closed tab or a killed
invocation loses the top-up silently and nothing retries it. This pass asks
the database which collections are short and fixes them, for every user.

| | |
|---|---|
| **Finds** | one query across all personal vaults: approved users, not archived, fewer than `MAX_UNREVIEWED` unreviewed topics, neediest first |
| **Caps** | `MAX_GROWS_PER_RUN` (2) — a grow is up to two 20s plan attempts, so two is what fits a 60s invocation |
| **Yields** | at 400 model calls in 24h, so an unattended job cannot drain a 500/day ceiling shared with real people |
| **Then** | drains one draft, because the status poll only runs while somebody has the app open |

**An idle pass costs nothing** — measured: no candidates, no queue, zero
model calls. That is the point of excluding stocked collections in SQL
rather than looping and checking.

**Guarded by `CRON_SECRET`, failing closed.** With the variable unset the
route refuses everybody, including the scheduler, and answers 404 rather
than 401 so an unauthenticated caller learns nothing. A route left open
because an env var is missing is how a free tier gets drained.

**No pass-level `usage_event`.** `user_id` is NOT NULL, so the only way to
write one would be to pin system work on somebody's account and make the
per-user figures in admin a lie. Each grow is logged against the user whose
quota it spent. A stopped cron shows up as collections sitting below the
threshold, which is a better signal than a heartbeat.

### The draft queue

`backend/src/onboarding/queue.ts`, table `draft_queue`.

Drafting used to run inline in whichever request asked for it, so the work
existed only as long as that invocation did. Overrun the 60s limit or get
killed and the note stayed a one-line placeholder with nothing, anywhere,
that knew to retry. Three notes in one user's vault sat like that for a day.

| | |
|---|---|
| **Enqueued by** | `growSpace`, and `reconcileQueue` for anything stranded |
| **Claimed by** | one `UPDATE … FOR UPDATE SKIP LOCKED` statement that also refuses to claim while another job is in flight (`IN_FLIGHT_SECONDS`, 30) |
| **Batch** | **one** job per drain. A draft normally takes ~4s and has been seen taking 28; three in sequence cannot fit a 60s invocation |
| **Driven by** | `GET /api/onboarding/status` — the banner polls it every 5s, and keeps polling while the queue is non-empty even after the caller's own job finished. There is no long-running worker to put this on |
| **Retried** | up to `MAX_ATTEMPTS` (3). A 429 is refunded rather than charged an attempt — it says nothing about the job |
| **Swept by** | `POST /api/onboarding/queue/sweep` — scans notes for placeholders no job is tracking |
| **Visible in** | admin › Model usage, as pending / in flight / given up on |

**`growSpace` enqueues and returns; it does not draft.** It used to end with
`await drainQueue()`, which put the work back inside the invocation the queue
exists to get it out of — a plan call plus three drafts against a 60s
ceiling. That is what was timing out `/api/onboarding/grow`. The route now
drains exactly one job after growing, and the poll takes the rest.

**Why not a Postgres advisory lock.** It was the obvious way to serialise
drains and it is wrong here: `pg_advisory_lock` is session-scoped and `db` is
a connection pool, so the unlock can land on a different connection than the
lock did — and then it is never released and the queue wedges permanently.
The in-flight predicate is pool-safe and self-expiring.

One job at a time, each ~4s, is about 12 model calls a minute — inside the
free tier's 15 rpm. The concurrency guard is also the rate limiter, which
beats a second throttle that has to be kept in step with Google's numbers by
hand.

**Every model call has a deadline of its own** (`llm/meter.ts`, one table
keyed by source: 20s for a plan, 25–30s for a draft). A draft was measured
at 55.6s — it did not fail, it ran until the platform killed the invocation
holding it, and the queue row then sat 'running' for the full five-minute
reclaim before anything retried it. A call that gives up at 30s fails inside
a process still alive to write that down. `WORST_CASE_JOB_MS` is derived
from that timeout rather than guessed from past latencies, which is what
made it wrong: it said 30s against a worst observed 28s, and the next
sample was 55.6s.

The deadline is enforced twice, because the two mechanisms fail differently.
The abort signal reaches `fetch` and closes the socket, so the work actually
stops. The `Promise.race` releases the *caller* on time regardless — an
abort only helps if the transport honours it, and a promise that never
settles is the exact failure being designed out.

A timeout is charged an attempt, unlike a 429: a model too slow to answer in
30s will still be too slow on the next poll, and three free retries a minute
is how a quota gets spent on nothing. Three attempts, then it lands in
admin › Draft queue with a Retry button and a human decides.

**Drains take an absolute deadline, not their own start time.** `/grow`
plans before it drains, and a drain measuring only its own elapsed time
cannot see the 20s the invocation already spent.

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

- **The scores are asked for, never assumed.** The gesture used to write
  `+1 confidence` and nothing at all for importance or interest. Finishing a
  note is the only moment you can say how well it landed and whether you
  want more of it, and that judgement was being thrown away.
- **The dialog is portalled to `<body>`.** On touch its caller is the review
  sheet, which is `position: sticky` with a z-index — that makes a stacking
  context, and an overlay inside one is confined to it however high its own
  z-index goes. The symptom was the bottom nav painting over Submit.
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
