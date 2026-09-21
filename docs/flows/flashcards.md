# Flashcards flow

**Ten cards a day, term on one side and definition on the other.** Drawn from
the notes you have reviewed and weighted towards the ones you rated least
confident — the material that has not stuck is the material worth drilling.

---

## Trigger

The Flashcards tab (`src/features/flashcards/FlashcardsView.tsx`). One deck
per user per day, enforced by a unique index on `(user_id, day)` in
`flashcard_decks`.

`day` is the client's local `YYYY-MM-DD`, the same value the quiz and the
review cap use, so "one a day" means one calendar day where the user is.

The tab used to open the vault's `Flashcards.md` dashboard, and was disabled
outright on any vault without that file. It is a destination now, like Quiz.

---

## Steps

| # | Step | Owner |
|---|---|---|
| 1 | Score every reviewed topic note | `flashcards/build.ts` → `collectSources` |
| 2 | Weighted-sample 8 notes to draw from | `pickSources` |
| 3 | Extract term/definition pairs — one model call for all of them | `extractTerms` |
| 4 | Weighted-sample the day's cards, balance the faces | `dealDeck` |
| 5 | Store the whole deck | `POST /api/flashcards/today` |

**Source material.** `## AI Notes` on notes whose `last_reviewed` is set —
the same test the ranking, the review control and the quiz use. Unlike the
quiz there is no section that already holds the material, so the terms have
to be extracted; the definitions must come from the note's own prose rather
than from what the model knows about the title.

**One model call, not ten.** Ten would be ten times the latency and ten
times the rate-limit budget for a worse result: a model that sees the whole
set at once does not define the same idea twice. Measured at ~3.2s for
18-20 usable pairs.

### The weighting

```
weight = (5 − confidence) × 2  +  importance × 1  +  interest × 0.5
```

Confidence dominates, and it is the **gap** to mastery that counts, not the
score: a note at 5/5 has nothing left to drill. Importance and interest
break the ties. The same three dials the review list sorts by, weighted for
a different question.

Applied twice — once to choose which notes the model sees, once to choose
which of its terms make the deck.

---

## Invariants

- **Random and weighted, not one or the other.** Both were asked for and
  they pull against each other: sorting by weight would deal the same ten
  cards every day until something was reviewed, and a flat shuffle would
  ignore the weights. Efraimidis-Spirakis weighted sampling (`random **
  (1 / weight)`, take the top k) does neither — a heavier note is likelier
  every day without ever being certain. Measured over 20,000 deals of 2
  from 4: 78% / 68% / 44% / 10% for weights 17.5 / 12.5 / 7.5 / 1.5, in
  order and with nothing starved.
- **The faces are balanced, not flipped independently.** Ten coin tosses
  land all-one-way often enough to matter. A deck of ten is always five and
  five, shuffled into a random order — 0 all-one-side decks in 5,000, and
  133 distinct face orders in 200 deals. The same lesson as the quiz's
  options, which the model returned as A five times out of five when asked
  to vary them.
- **Which side a card opens on is stored, not decided at render.** A card
  that flips to a different face on reload is a different card.
- **The pool must be larger than the deck**, or the weighting is
  decorative. The first live run asked six notes for "up to 3 terms each"
  and dealt eight cards for a ten-card deck: notes vary in how much
  definable material they hold, some get skipped, and validation drops
  more. The prompt now states the target total and is shown eight notes.
- **A definition never contains its own term.** Checked on the stem, so
  "chemosynthesis" catches "chemosynthetic" — otherwise the
  definition-first half of the deck gives away every answer it asks for.
- **A malformed pair is dropped, not repaired.** A card whose answer is
  printed on the question is worse than a shorter deck.
- **The daily limit lives in one place.** `cardsPerDay()` in `build.ts`,
  keyed by plan tier — free is 10 and every account is on free. A limit at
  the call site is a limit that disagrees with the copy describing it.

---

## What it writes

**`flashcard_decks`** — one row per user per day: the cards as dealt, with
the side each one opens on.

**`usage_events`** — one `llm_call` with source `flashcards-build`. One
extra model call per user per day against the 500/day ceiling.

Nothing is written back to the notes. Unlike the quiz there is no graded
answer here — flipping a card is not evidence of anything, and moving
confidence on it would make the number describe how many cards you turned
over.

---

## Known gaps

- **No self-rating.** The obvious next step is "got it / didn't", which
  would feed confidence the way the quiz does and let tomorrow's deck avoid
  what you already know. Deliberately not built yet: it needs a considered
  answer to what a flip means before it can move a score.
- **`day` is supplied by the client**, the same trade as the quiz and the
  review cap.
- **Cross-space decks are not signposted.** Cards are drawn from every
  collection at once, so a marine biology deck can contain a statistics
  term. The note name under the card is the only cue.
