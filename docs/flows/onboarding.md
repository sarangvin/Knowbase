# Onboarding flow

**A topic goes in; a drafted space comes out.** The user types "Marine
Biology" and ends up with a folder of five prerequisite-ordered notes, each
with a real first draft, plus a Next Up dashboard over them.

The defining decision: **none of it blocks the user.** Generating a
curriculum is roughly six model calls, and there is no version of that which
is fast enough to wait for. So the wait was removed rather than optimised —
the request returns as soon as the job is recorded, and the user browses the
demo space while the server works.

---

## Trigger

| Entry point | File |
|---|---|
| Landing screen, before sign-in | `src/features/onboarding/Onboarding.tsx` |
| Empty vault or the collections home | `src/features/onboarding/TopicLauncher.tsx` |
| The owner approving a waitlisted account | `backend/src/routes/admin.ts` |

The first two call `startOnboarding(topic)` →
`POST /api/onboarding/start` (`backend/src/routes/onboarding.ts`).

`TopicLauncher` renders `null` unless `user.accessApproved`. Generation spends
the owner's model key, so the server refuses an unapproved account; saying so
up front beats letting someone type a topic and handing back a 403.

### The topic is asked for exactly once

It is typed on the landing screen *before* sign-in, and has to survive
everything that happens next. Three mechanisms, because there are three ways
the moment of typing can be separated from the moment of building:

| Gap | Carried by |
|---|---|
| The Google OAuth full-page redirect | `localStorage`, via `pendingTopic.ts`. Not a query parameter: it stays out of server logs and `Referer` |
| Landing screen rendered again after the redirect | `peekPendingTopic()` pre-fills the input, and an effect auto-starts for an approved user — so the screen is usually not seen at all |
| Days spent on the waitlist | `users.requested_topic`, sent with `POST /auth/request-access`. Approving the account starts that build immediately |

`peek` versus `take` matters. The handoff used to be take-only, so whenever
the automatic start did not fire — an unapproved account, most obviously —
the topic sat unread in storage while the user looked at an empty box and
typed it again.

`App.tsx` fetches the job **before** consuming the handoff: approval may have
started the build already, and a stale handoff would generate the same space
a second time at six model calls a go.

---

## Steps

`backend/src/onboarding/run.ts` — `runOnboarding(userId, topic)`. Fired with
`waitUntil`, never awaited by the request.

| # | Step | Owner | Notes |
|---|---|---|---|
| 0 | Record the job, return `202` | `routes/onboarding.ts` | A job already `running` returns the existing one instead of starting a second |
| 1 | Look for the topic in the reuse corpus | `vault/spaces.ts` → `findLibrarySpaceFor` | Name-key equality only, deliberately dumb. A hit copies the space and finishes here — instant and free against ~6 model calls |
| 2 | Generate the plan | `onboarding/plan.ts` → `generateLearningPlan` | Throws with a user-facing message; the catch in `run.ts` is what surfaces it |
| 3 | Draft the landing note | `onboarding/draftNote.ts` → `draftOne` | Just the one, so step 4 can write a space whose entry point is real |
| 4 | Write the whole space | `run.ts` | **One insert.** A user opening their vault mid-run never sees a half-built folder |
| 5 | Draft every remaining note | `run.ts` | Sequential, for the per-user rate limit |
| 6 | Mark `status: 'ready'` | `run.ts` | Only after step 5 — see invariants |
| 7 | Contribute to the corpus | `vault/spaces.ts` → `contributeToLibrary` | Insert-only; failure is ignored, the user's notes are already saved |

### What the user sees meanwhile

`src/features/onboarding/OnboardingBanner.tsx` polls
`GET /api/onboarding/status` every **5s**, and also on window focus — a locked
phone stops timers, and focus is what actually covers that case. On `ready` it
offers the space; `POST /api/onboarding/ack` stops it reappearing.

---

## What it writes

**`onboarding_jobs`** (one row per user, upserted on `userId`):
`topic`, `status` (`running` | `ready` | `failed`), `space`, `openPath`,
`notesTotal`, `notesDrafted`, `error`, `acknowledged`.

**`notes`** under `Automated Graph/<Space>/`:

- `Topics/<Subtopic>.md` — one per subtopic, from `buildTopicNote`
- `Next Up.md` — the dashboard, from `buildNextUpNote`

Generated topic frontmatter, hardcoded in `notePlan.ts` and never taken from
model output:

```yaml
space:                  # ← empty. Known gap, see below
status: frontier
prerequisites: [...]    # wikilinks to sibling topics
importance: 1-5         # from the plan
interest: 1-5           # from the plan
confidence: 0
last_reviewed:          # empty — a new note has never been reviewed
```

**`usage_events`** — one `llm_call` per model call via
`backend/src/llm/meter.ts`, plus a `note_write`. Everything that spends the
key goes through the meter, or the admin usage figures are a confident-looking
undercount.

---

## Limits

Free plan, in `onboarding/limits.ts` — one table, so a number and the copy
describing it cannot disagree.

| | |
|---|---|
| Active collections | **5** |
| New collections per day | **3** |

Two different questions, answered from two different places on purpose.

**Active** is about what you have, so it is counted from the vault:
collections that exist, minus archived ones. Archiving is how you make room
under the cap without losing anything, which is most of why that feature
earns its place. Deleting frees a slot too.

**Per day** is about what you spend, so it is counted from
`collection_starts`, a ledger that outlives what it paid for. A daily limit
you can reset by deleting this morning's collection is not a limit, and
each collection is six model calls against a ceiling everyone shares.

Both are checked at `POST /api/onboarding/start`, which is the only door
that creates one — adoption from the corpus happens inside the run behind
it, so it is covered by the same check. The row is written only once the
job is actually created, so a refused request never counts against the day.

When both are hit the **active** message is shown, because it is the one
the reader can act on now; telling them to come back tomorrow when the real
problem is a full shelf sends them away for nothing.

---

## Invariants

- **`confidence: 0` and an empty `last_reviewed`.** "Brand new" is a product
  invariant, so these are hardcoded rather than trusted from generated data.
  A generated note must never look reviewed.
- **`status: 'ready'` means the space exists and the note you land on is
  written.** It used to mean all five were, drafted inline before the run
  announced itself — affordable while five drafts took ~14s in total. They do
  not: on the run that changed this the plan took 12.5s and the first two
  drafts 17.4s and 8.2s, and the invocation was killed by the 60s ceiling
  with three notes unwritten and nothing anywhere that knew to finish them.
  The rest are **queued** now, like `/grow`'s, so they are visible in admin,
  retried, and swept up when an invocation dies. The banner says "n of 5
  notes written" — the honest version of a promise one invocation can no
  longer keep.
- **Draft progress is counted, never stored.** `notes_drafted` on the row is
  only what the run itself wrote; the queue writes the rest and has no
  business updating that table. `/status` counts topic notes that no longer
  hold the placeholder sentence — the same test `queue.ts` makes.
- **Only written notes reach the corpus.** A placeholder there is worse than
  nothing: adoption would hand the next person a space of one-line stubs and
  never generate the real thing. The run contributes what it drafted; the
  queue contributes each note as it lands.
- **The space is written in a single insert.** No partially-built folder is
  ever observable.
- **Corpus lookup is an optimisation, never a dependency.** If the copy falls
  through, generate.
- **Contributing to the corpus is insert-only.** An existing note — including
  anything the owner has curated — is never modified.
- **Contribute when the note is written, not at the end of the run.** It
  used to be the last thing `runOnboarding` did, so an invocation killed
  before it finished contributed nothing at all — and one was. "System
  Architecture for PMs" reached the corpus with the three notes the queue
  drafted, none of the two the run wrote, and no `Next Up.md`.
- **Adoption never promises a landing note the copy does not have.** That
  same space had no `Next Up.md`, and `adoptSpaceInto` returned its path
  regardless — giving the adopter a collection card that opens nothing. It
  falls back to the first topic.
- **Nothing personal reaches the corpus.** `asCorpusCopy` is the one
  sanitiser, applied in `contributeToLibrary`, which is the only writer to
  the global vault.

  It empties `## My Notes` — the one section its author writes, on a vault
  strangers read — keeping the heading so an adopted note still has
  somewhere to write. And it resets `confidence`, `last_reviewed` and
  `status`, because the corpus is a starting point and onboarding's own
  invariant is that a generated note must never look reviewed. Without
  that, adopting a space handed you someone else's study history: Next Up
  counting their topics as studied, a review date you never set, the quiz
  drawing on notes you have not read. Frontmatter only, so a line of prose
  beginning "status:" is left alone.

  Both used to be safe only by circumstance — every caller passed content
  captured before anyone could edit it, and the route said so in a comment.
  That is an argument about callers, not a property of the corpus, and it
  stopped holding the moment notes became editable.
- **The global corpus is the owner's.** Users read from it by adoption; they
  never see it as a vault.
- **The demo vault is only shown to someone with nothing of their own.**
  While a space is generating there is nothing of theirs to show — for a
  first run. For anyone who already has collections that is false, and
  loading the demo on boot threw them out of their own vault on every reload
  until the job finished. `App.tsx` loads their vault first and falls back to
  the demo only when it comes back empty.
- **Unwritten notes plus an empty queue triggers a reconcile.** That pair is
  the stranded case — an invocation died holding work nothing else knew
  about. `/status` sweeps only then; on every poll it would scan the notes
  table every five seconds to find nothing.
- **A stale job that has a space and a landing note is reported ready, not
  failed.** It built the space and died before saying so. Calling that failed
  offers a "Try again" that generates the whole thing a second time under a
  disambiguated name — worse than the state it is recovering from.
- **A `running` job with no progress for two minutes is reported as failed.**
  The run happens under `waitUntil`, after the response — a deployment
  cutover or a hard kill takes it with no error to catch and nothing written
  down. Nothing reclaimed a stale row the way the draft queue reclaims its
  own, and `/start` refuses to act while a job is running, so the spinner
  never resolved and "Try again" was a silent no-op: one killed invocation
  ended onboarding for that account permanently. Two minutes is not a slow
  run — the whole thing is ~25s and every step patches the row on its way
  through. The staleness is *reported*, not written back; the next `/start`
  overwrites the row anyway, and this keeps a read path from taking a write.

---

## Known gaps

- **`space:` is written empty** on every generated note
  (`notePlan.ts`, the template literal). Nothing reads it — paths drive
  everything, via `spaceOfPath` — so it is cosmetic, but Properties renders a
  blank row and an exported vault has a field that says nothing.

- **`## Questions` is generated as bullets**, which no consumer can act on.
  See [review.md](review.md#known-gaps).
- **500 requests/day** on `gemini-3.5-flash-lite` at ~6 calls per onboarding
  is roughly 80 new spaces per day. Tracked in the admin Usage tab; the
  ceiling itself has not moved.
