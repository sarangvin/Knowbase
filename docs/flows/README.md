# Flow context sheets

One sheet per user-facing flow, written for whoever has to change it next —
human or model. Each answers the same questions in the same order:

1. **What triggers it** and what the user sees.
2. **The steps**, in order, with the file that owns each.
3. **What it writes** — the fields and rows that outlive the request.
4. **Invariants** — the rules that must keep holding, and why they exist.
5. **Known gaps** — what is wrong or missing today.

## Why these exist

Almost every bug in this app so far has been the same shape: two pieces of
code answering one question differently, each reasonable alone.

- A Vercel rewrite named its capture group `:path*`, which silently clobbered
  the app's own `?path=` query parameter.
- `readSSE` split events on `\n\n`; Google sends `\r\n\r\n`.
- The review control decided "reviewed today?" with a local date; the Next Up
  ranking used a UTC `daysSince` and never asked at all. Result: the app
  recommended a note and then refused to let the user review it.
- Generated notes wrote their questions as `- bullets`; every consumer that
  acts on questions looks for `Q:` blocks. The section never worked until
  [questions.md](questions.md) made everything read both and write one.

None of these are visible from inside either file. They are only visible from
a description of the whole path, which is what these sheets are.

## Sheets

| Flow | File |
|---|---|
| Onboarding — topic in, drafted space out | [onboarding.md](onboarding.md) |
| Review — closing the loop on a note | [review.md](review.md) |
| Quiz — five questions a day, scored back into the notes | [quiz.md](quiz.md) |
| Flashcards — ten cards a day, weighted by what has not stuck | [flashcards.md](flashcards.md) |
| Questions — answering a note's questions, and asking your own | [questions.md](questions.md) |

## Keeping them true

A stale sheet is worse than no sheet, because it is believed. When you change
a flow, change its sheet in the same commit — particularly the **invariants**
and **known gaps** sections, which are the parts anyone actually acts on.
