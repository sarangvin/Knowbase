# Quiz flow

**Five multiple-choice questions a day, from notes you have actually
reviewed.** Answering feeds straight back into the note: right raises its
confidence, wrong lowers it, and confidence is what orders the review list.
That loop is the point — without it the quiz is a game attached to the side
of the app rather than part of it.

---

## Trigger

The Quiz tab (`src/features/quiz/QuizView.tsx`). One quiz per user per day,
enforced by a unique index on `(user_id, day)` in `quizzes`.

`day` is the client's **local** `YYYY-MM-DD`, the same value the review cap
uses, so "one a day" means one calendar day where the user is rather than
wherever the database thinks it is.

---

## Steps

| # | Step | Owner |
|---|---|---|
| 1 | Collect every question from every reviewed topic note | `quiz/build.ts` → `collectCandidates` |
| 2 | Pick five, spread across notes | `pickQuestions` |
| 3 | Turn them into MCQs — one model call for all five | `buildQuestions` |
| 4 | Shuffle each question's options, remap the answer index | `buildQuestions` |
| 5 | Store the whole quiz | `POST /api/quiz/today` |
| 6 | Answer one question | `POST /api/quiz/answer` |
| 7 | Move that note's confidence ±1 | `quiz/score.ts` → `applyQuizResult` |

**Source questions.** The `## Questions` section of notes whose
`last_reviewed` is set. Asking about a note someone has never opened tests
the generator, not them. `questionsOf` reads **both** shapes found under that
heading — the generator's `- bullets` and Ask AI's `Q:` blocks. (Sync still
reads only `Q:`, which is why it finds nothing on a generated vault. See
[review.md](review.md#known-gaps).)

**One model call, not five.** Five would be five times the latency and five
times the rate-limit budget, for a worse answer — the model can see the whole
set at once and avoid repeating itself. Options are grounded in each note's
own `## AI Notes` text rather than in whatever the model knows about the
topic.

---

## Invariants

- **The server owns the questions, the key and the score.** The client is a
  renderer. Not because you could cheat yourself, but because a quiz that
  regenerates on reload is not the same quiz, and a daily cap the client
  enforces is not a cap.
- **The answer index is withheld** until that question is answered.
- **The first answer stands.** Re-answering returns the original result with
  `alreadyAnswered: true` and does not move the score — otherwise the score
  records how many times you were willing to try.
- **Options are shuffled server-side.** Asked to "vary which index is
  correct", the model returned A five times out of five: a quiz you could
  score 5/5 on by tapping the first option without reading. Permuting
  afterwards is deterministic and cannot be ignored. Verified uniform over
  40k shuffles.
- **Questions spread across notes.** A flat random draw returns three from
  one note, because a note contributes three.
- **Confidence clamps to 0–5**, and a move that changes nothing reports
  `null` rather than `5 → 5`.
- **`status` is kept honest in both directions.** Review only ever wrote
  `known` on the way up, which was fine while nothing went down. A quiz that
  lowers confidence makes a note stuck on `known` at 1/5 a real possibility.
- **`last_reviewed` is never written here.** Answering a question about a
  note is not reading it, and stamping the date would silently consume the
  note's once-a-day review and move it out of the study queue on the
  strength of one lucky guess.
- **A malformed question is dropped, not repaired.** A quiz question with a
  guessed answer is worse than a four-question quiz.

---

## What it writes

**`quizzes`** — one row per user per day: the questions as asked, the options
as shown, the key, what was picked, the score, and when it completed.

**`notes`** — one frontmatter line per answer (`confidence`, and `status`
when it crosses the threshold), via the shared writer in
`vault/frontmatter.ts`.

**`usage_events`** — one `llm_call` with source `quiz-build`, through the
meter. One extra model call per user per day against the 500/day ceiling.

---

## Known gaps

- **The client's vault index does not refresh** after a quiz, so Next Up and
  the note's own Properties keep showing the old confidence until the app
  reloads. The answer response carries the change so the quiz screen can
  show it, but the rest of the UI is stale.
- **`day` is supplied by the client.** Sending a different date would yield
  another quiz. Same trade as the review cap: it is a personal learning tool,
  and the alternative is guessing the user's timezone server-side.
- **Cross-space quizzes are not signposted.** Questions are drawn from every
  space at once, so a marine biology quiz can contain a statistics question.
  The note title above each question is the only cue.
