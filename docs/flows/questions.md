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
| 1 | Parse the section for display | `reader/questionsFormat.ts` |
| 2 | Answer a question | `POST /api/notes/answer` |
| 3 | Add one of your own | the same route, `custom: true` |
| 4 | Generate the answer from the note | `notes/questions.ts` → `generateAnswer` |
| 5 | Write it back into the note | `setAnswer` → the `notes` row |
| 6 | Delete a question and its answer | `DELETE /api/notes/question` |

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
  The client re-reads the vault afterwards rather than patching state, so
  what is on screen is what is in the note.
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
- **Any question can be deleted, not only your own.** A generated question
  that is wrong or dull is noise on a note you have to keep reading.
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
