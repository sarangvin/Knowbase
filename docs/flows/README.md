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
| Hidden buffer — three notes waiting behind the three you can see | [buffer.md](buffer.md) |
| Quiz — five questions a day, scored back into the notes | [quiz.md](quiz.md) |
| Flashcards — ten cards a day, weighted by what has not stuck | [flashcards.md](flashcards.md) |
| Questions — answering a note's questions, and asking your own | [questions.md](questions.md) |

## Plans and limits

Every limit in the app is one row of `backend/src/plans.ts`, keyed by
`users.plan_tier`. They used to be three tables in three files, which meant
adding a second plan was three edits that had to agree.

| | Free | Pro |
|---|---|---|
| Active collections | 5 | no limit |
| New collections per day | 3 | no limit |
| Flashcards in a day's deck | 10 | 20 |
| Your own questions, per collection per day | 1 | no limit |

**A deck is never unlimited.** It is a sitting, and an infinite one is not a
longer sitting but a broken one, so Pro gets a bigger number rather than no
number.

**No limit is `Infinity` in the code and `null` over the wire.**
`JSON.stringify(Infinity)` is `null` anyway — the routes say so on purpose
rather than relying on that, because a client that reads it as the number
zero tells a paying account it has used up an allowance it does not have.
That was a real bug, caught by testing the serialised shape rather than the
function.

The quiz's one-a-day is **not** on this table: it is a unique index on
`(user_id, day)` and a product decision about spacing rather than a plan
limit. Lifting it for Pro would mean a migration and a different idea of
what a quiz row is.

The owner can set a tier by hand in admin › Users. For a real subscriber the
Razorpay webhook remains the source of truth and will overwrite it; the
override is for the owner account and comped ones.

## Keeping them true

A stale sheet is worse than no sheet, because it is believed. When you change
a flow, change its sheet in the same commit — particularly the **invariants**
and **known gaps** sections, which are the parts anyone actually acts on.
