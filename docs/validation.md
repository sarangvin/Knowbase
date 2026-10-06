# Validation checks

What to run after a deploy of Rabbithole (KnowBase), and what each check is for.
Everything here is runnable in one go:

```bash
scripts/validate-deploy.sh            # checks HEAD
scripts/validate-deploy.sh <sha>      # checks a specific commit
```

It is safe against production. API probes are unauthenticated, and database
checks run with `default_transaction_read_only = on`. A section whose input is
missing prints `SKIP`, never a pass. The pure rule checks can also run alone:

```bash
DATABASE_URL=postgres://x@localhost/none npx tsx scripts/streak-rules.mts
```

(The dummy `DATABASE_URL` is only there because importing the streak module
loads the DB client; nothing connects.)

Written for the model fallback chain, the daily streak, streak graduation and
the raised tier limits; last run on the deploy that shipped them. Add a check
here when a change adds a rule that a later change could quietly break.

## 1. Static

| Check | Why |
|---|---|
| `tsc -b` | Frontend and backend share types through the admin API; this catches a field renamed on one side. |
| `oxlint` has no errors | Warnings are tolerated (there are old ones); errors are not. |
| `npm run build` | The Vercel build runs the migration first, then this. A build that fails locally fails there. |
| `scripts/streak-rules.mts` | The rules most likely to regress, as plain assertions (below). |

### Rules asserted in `streak-rules.mts`

**Streak** (days are the reader's local days; a day counts if they read a new
note, finished the day's flashcards, or finished the quiz):

| Scenario | Expected |
|---|---|
| no activity | 0 days, 2 freezes |
| today only | 1 day |
| yesterday only, today pending | 1 day. Not done *yet* is not a miss |
| three straight days | 3 days |
| one missed day in the middle | frozen: streak continues, the day is not counted, 1 freeze left |
| two missed days | both freezes spent, streak continues |
| three missed days in a row | streak ends |
| third separate miss, no refill | streak ends |
| seven kept days | one freeze earned back |
| freezes held | never more than 2 |

**Limits** (collections / grown notes / Ask AI, per day): `new` 2/6/5, `free`
5/20/10, `pro` unlimited. Shared pool across all `new` accounts: 300 model
calls per quota day. An unapproved account is tier `new` whatever its plan row
says; an approved one is its plan.

**Model chain**: starts at `gemini-3.5-flash-lite`; no duplicates; an empty
`GEMINI_MODEL=` is ignored (it used to be sent as a model named `""`, which is
what 404'd locally); a set `GEMINI_MODEL` goes first.

## 2. Deploy status

The commit's GitHub status from Vercel must be `success`. The script waits up
to five minutes. `pending` for longer means the build is stuck; check the
Vercel dashboard. The build runs `db:migrate:ci` first, so a migration error
shows up as a failed deploy, not as a broken site.

## 3. Production serves this build

Compares the hashed asset names in the live `index.html` and `admin.html`
against `dist/`. This is the reliable test: grepping minified JS for a string
is not, because the bundler renames and inlines. A mismatch right after a
success status usually means the CDN has not caught up; wait a minute. A
persistent mismatch means the deploy built something other than local `dist`
(different lockfile or env).

## 4. Production API, unauthenticated

| Request | Expect | Why |
|---|---|---|
| `GET /api/vaults` | 401 | auth is enforced, and the serverless function is up |
| `GET /api/account/streak` | 401 | the new route is mounted and behind auth |
| `GET /api/onboarding/jobs` | 401 | approval gate removed, auth gate still there |
| `GET /api/admin/usage` | 403 | admin is owner-only |
| `POST /api/llm/free/chat` | 401 | Ask AI needs a session |

A `404` on any of these means the route is not mounted or the rewrite in
`vercel.json` is wrong. A `500` means the function crashed on import; read
the Vercel runtime logs.

## 5. Production database, read-only

Reads `DATABASE_URL_UNPOOLED` from `.env.vercel`. (The pooled URL is not used
for checks that need `SET`.)

| Check | Why |
|---|---|
| `users.access_approved_by` and `access_revoked_at` exist | migration 0018 ran |
| no account has `access_revoked_at` set | right after deploy nobody has been revoked since the column existed; a non-zero here means something wrote it that should not have |
| no non-owner approved in the last hour without a recorded approver | every approval path (admin button, streak) must say who approved; a gap means a path was missed |
| `INFO` line: approved / new / graduated-by-streak counts | eyeball only. The approved count must not drop after a deploy |
| `INFO` line: fallback calls in the last 24h | eyeball only. Non-zero means a model refused and the chain worked |

## 6. Gemini model chain, live

Needs `GEMINI_API_KEY` in `backend/.env`. The first two models in the chain
must be in Google's model listing for the key, and the primary must answer a
real request. A `429` here is not a bug: it means the day's quota for that
model is spent, which is what the chain exists for. Read the admin panel's
**Model usage → Fallback chain** table to see which model is carrying traffic.

## Not covered by the script (check by hand when these areas change)

- **The streak card on a phone.** The badge is sized up on mobile like the
  other top-bar buttons; only desktop has been looked at.
- **Finishing a real note and turning real flashcards.** The hooks are wired;
  the end-to-end trigger has been exercised through a completed quiz only.
  Open the app signed in, finish a note you have not finished before, and
  expect the card to appear within about three seconds.
- **A real graduation.** Needs an account at least 48 hours old that is not
  approved and has met the goal on three days. The server side was exercised
  locally (graduates, does not re-graduate, will not graduate when revoked or
  under 48 hours old); production has not graduated anyone yet.
- **A model refusing in production.** Local test put a model that 404s at the
  head of the chain and the call fell through. Production has only ever had
  everything healthy.

## Local setup used for the checks above

```bash
brew services run postgresql@16        # stop afterwards: brew services stop postgresql@16
npm run db:migrate                     # applies backend/drizzle to the local DB
```

To act as a user locally, insert a `users` row and a `sessions` row, then send
`Cookie: kb_session=<session id>`. Delete the rows when done.
