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
| 4 | Hold back what is not due, then weighted-sample and balance the faces | `dealDeck` |
| 5 | Store the whole deck | `POST /api/flashcards/today` |
| 6 | Turn a card: mark it reviewed, push out its next due date | `POST /api/flashcards/turn` → `schedule.ts` |

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

### Spacing

`flashcards/schedule.ts`, table `flashcard_reviews`. The gap doubles each
time a card is turned over:

| Turn | 1 | 2 | 3 | 4 | 5+ |
|---|---|---|---|---|---|
| Next gap (days) | 2 | 4 | 8 | 16 | 30 |

Two days, not one, because "not the following day" is the requirement.
Thirty is the ceiling — reached on the fifth turn — because a month is
about as long as a gap can get before a card stops feeling like part of the
deck and starts feeling like a surprise.

### Bookmarks

A bookmark is "show me this one sooner": it pulls the due date to tomorrow
and gives the card **first claim** on that deck, taken rather than sampled,
because asking to see a card sooner and then not seeing it is worse than
not offering the button.

It lasts exactly until the next turn. A standing bookmark would become a
card that never leaves the rotation, and the honest way to say "still not
sticking" is to bookmark it again when it comes back.

**A bookmarked card holds its gap instead of doubling it.** Without that
the button is a trap: you flag a card at a 16-day gap because you did not
know it, see it tomorrow, and the turn pushes it to 30 — further away than
if you had never asked. Asking to see something sooner cannot be the thing
that makes it rarer. The rule lives in `intervalAfterTurn`, which is a
separate function purely so it can be tested without a database.

Bookmarking does **not** touch `reps` or `interval_days`: the card's real
place in the schedule is still needed once the bookmark is consumed.

**Not SM-2 proper, on purpose.** SM-2's ease factor is driven by how well
you said you did, and this deck has no self-rating: turning a card over
says you looked at it. Inventing a grade from a tap would be a number that
looks like data and is not. The doubling is the one curve a turn honestly
supports; an ease factor goes in when there is a signal to drive it.

**Cards are identified by note + normalised term**, because they are
extracted afresh each morning and there is no stored card to point at.
`termKey` lowercases, strips punctuation and a trailing plural, so
"Chemoautotrophs" today and "chemoautotroph" tomorrow are one card rather
than a way to be asked the same thing twice. Note *and* term, because the
same word defined by two notes is two cards — knowing it in one context is
not knowing it in the other.

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
- **Spacing outranks weight.** A card not yet due is held back however
  heavily its note scores, or the schedule is advisory and a card turned
  yesterday comes back today — the one thing it exists to prevent. Verified:
  0 not-due cards across 500 decks while due cards remained.
- **A short deck is worse than an early repeat.** A vault with fifteen terms
  runs out of due cards within a week. A shortfall is filled from the
  held-back cards, **soonest-due first** — the ones closest to ready, not
  the ones just seen. Verified: with 3 due and a deck of 10, it deals 10,
  and the 7 fillers come back in due-date order.
- **A turn is recorded once.** Turning a card back to look again is looking
  again, not un-seeing it: `turnedAt` is written once, and the schedule
  advances at most once per card per day. The turn counter used to be
  `Object.values(flipped).filter(Boolean).length` over a local toggle, so a
  card looked at twice reported "0 turned" — the visual face and the fact of
  having seen it are two different things and are now two different pieces
  of state, one local and one on the server.
- **The bookmark control is a sibling of the card, not a child of a face.**
  Nesting a button inside the card button is invalid, and one per face
  would be two controls to keep in step. It sits above both faces, so it is
  visible whichever way the card is showing and does not rotate with it.
  40x40, because the card underneath is one enormous tap target and a thumb
  aiming for a small bookmark would flip the card instead.
- **Bookmark state is read from the schedule, never copied onto the deck.**
  `GET /today` sends it alongside the cards. The same fact in two rows is
  the failure this codebase keeps repeating.
- **The daily limit lives in one place.** `cardsPerDay()` in `build.ts`,
  keyed by plan tier — free is 10 and every account is on free. A limit at
  the call site is a limit that disagrees with the copy describing it.

---

## What it writes

**`flashcard_decks`** — one row per user per day: the cards as dealt, with
the side each one opens on.

**`flashcard_reviews`** — one row per card ever turned or bookmarked: reps,
the interval that produced the due date, the due date, whether it is
bookmarked, and when it was last seen.

**`usage_events`** — one `llm_call` with source `flashcards-build`. One
extra model call per user per day against the 500/day ceiling.

Nothing is written back to the notes. Unlike the quiz there is no graded
answer here — flipping a card is not evidence of anything, and moving
confidence on it would make the number describe how many cards you turned
over.

---

## Known gaps

- **No self-rating.** "Got it / didn't" is what would turn the fixed
  doubling into a real ease factor, and let a card you fumbled come back
  sooner rather than on the same curve as one you knew cold. The schedule
  is built so that this drops in without a migration: `interval_days` is
  stored rather than derived from `reps`, so the curve can change without
  rewriting anyone's history.
- **Terms are extracted before the schedule is consulted**, so a model call
  can spend its budget producing cards that are then held back. Harmless —
  it is one call either way — but it means a user deep into a subject gets
  a pool thinner than its size suggests.
- **`day` is supplied by the client**, the same trade as the quiz and the
  review cap.
- **Cross-space decks are not signposted.** Cards are drawn from every
  collection at once, so a marine biology deck can contain a statistics
  term. The note name under the card is the only cue.
