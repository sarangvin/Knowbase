# Questions flow

**The `## Questions` section, made to do something.** Each question has an
Answer button; the answer is generated from the note's own text and written
back into the note. Readers can add a question of their own, rate-limited,
and delete any question they do not want.

This section existed from the first generated note and did nothing for
months. It is worth knowing why, because the reason is the shape.

---

## The two shapes, and why the section was inert

| Writer | Shape |
|---|---|
| The note generator (`notePlan.ts`) | `- a bullet per question` |
| Ask AI, Sync, and this flow | `Q: …` / `A: …` blocks |

Sync — the only thing that could answer a question — reads `Q:` and
therefore found nothing on a generated note, ever. The quiz had to learn to
read both. So: **everything reads both shapes, and only the `Q:`/`A:` shape
is ever written.** A generated bullet converts to a block the first time it
is answered, and a vault converges on one grammar instead of keeping two.

---

## Trigger

The Questions section of any note in a cloud vault
(`src/features/reader/Questions.tsx`). The reader is signed in and
approved; the demo vault shows the questions and says why the buttons are
not there.

---

## Steps

| # | Step | Owner |
|---|---|---|
| 1 | Write the questions **and their answers** with the note's first draft | `onboarding/draftNote.ts` |
| 2 | Parse the section for display | `reader/questionsFormat.ts` |
| 3 | Reveal an answer already in the note | the client, no request |
| 4 | Answer one that has none | `POST /api/notes/answer` |
| 5 | Add one of your own | the same route, `custom: true` |
| 6 | Generate the answer from the note | `notes/questions.ts` → `generateAnswer` |
| 7 | Write it back into the note | `setAnswer` → the `notes` row |
| 8 | Delete one of your own questions | `DELETE /api/notes/question` |

**Answers are written with the note, not on demand.** The draft call that
writes `## AI Notes` now returns `{q, a}` pairs and writes `Q:`/`A:`
blocks, at the same cost and the same latency — measured at 3.5s for a note
with three answered questions. So Answer is a *reveal*: instant, free, and
available offline. Only a note drafted before this change has to generate
one, and the button falls back to doing that with a spinner.

Collapsed by default even though the answer is sitting in the markdown. A
question you can read the answer to without asking is not a question, it is
a paragraph.

**Grounded in `## AI Notes`**, not in what the model knows about the title,
and capped at 4,000 characters. Measured at ~1s for a 3-sentence answer.

**The limit: one custom question per day, per collection**, for free plans.
Per collection rather than per note, because a collection is the unit
somebody studies in and a per-note allowance would scale with however many
notes the generator happened to produce — which is not a decision the
reader made. One number, in `routes/notes.ts`, so the limit and the copy
describing it cannot disagree.

---

## Invariants

- **The server owns every write.** Answers cost a model call and custom
  questions are rate-limited; a limit the client enforces is not a limit.
- **One note changed means one note re-read.** `refreshNote(path)` re-parses
  and re-indexes that note alone. Calling `reload()` here — which is what
  this did at first — goes through `loadFromSource`, which sets status to
  `loading` and rebuilds the tab stack: the reader got the full-screen
  "Digging the tunnels…" and landed back on Next Up after pressing Answer.
  `reload()` is still right for a change to the *vault* — a collection
  archived, deleted or newly built — and wrong for a change to one note.
- **A non-custom question must already be on the note.** Otherwise the
  route is a general-purpose model proxy with a note path attached.
- **A failed generation charges nothing and writes nothing.** The ledger
  row is only inserted after the answer comes back — otherwise a 502 costs
  somebody the one question they get that day.
- **Deleting does not refund the allowance.** "Ask, delete, ask again" is
  not a limit, and the model call has been spent either way. The ledger row
  outlives the question it paid for; the question and answer live in the
  note, the row is only the count.
- **Already answered means already answered.** Re-pressing Answer returns
  what is there instead of buying a second opinion nobody asked for.
- **Bullets inside an answer are part of the answer.** The block splitter
  is mode-aware: once a `Q:` opens, everything belongs to it until the next
  `Q:`. Without that, one answered question containing three bullets parsed
  as four questions — and since writing rewrites the whole section, the next
  answer would have reformatted that content into nonsense. Caught in the
  browser on a real note, not by the unit tests, which only had clean input.
- **Only your own questions can be deleted.** A generated question is part
  of the note the way the key points are; deleting them one at a time would
  make the note a different thing on every account and leave the quiz
  drawing from a set that quietly shrinks. Enforced on the server — the
  client hides the control, and a hidden control is not a rule.
- **Which questions are yours comes from the ledger**, not from a marker in
  the markdown. `custom_questions` already keeps a row per question ever
  asked, so the note stays plain text and an exported vault carries no
  bookkeeping.
- **Every control needs an account, not just a writable vault.** The demo
  vault is writable through a local overlay and has no account; an Answer
  button that 401s is worse than one that is not there.

---

## What it writes

**`notes`** — the question and its answer, in the note's own markdown, as a
`Q:`/`A:` block.

**`custom_questions`** — one row per custom question asked: user,
collection, local day, note path, question. The rate-limit ledger, not the
content.

**`usage_events`** — one `llm_call` per answer, source `note-answer` or
`note-answer-custom`.

---

## Known gaps



- **Sync still folds `## My Notes` into `## AI Notes`.** That was harmless
  while nothing wrote to My Notes; now it is a real editor, running Sync
  rewrites the reader's own words into the model's. Worth deciding whether
  Sync should leave that section alone.
- **`day` is supplied by the client**, the same trade as the quiz, the
  flashcard deck and the review cap.
- **No pagination or ordering.** Questions render in document order, and a
  note with thirty of them would be a long page.
