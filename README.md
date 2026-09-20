# Knowbase
Knowledge Base To Develop knowledge on a topic on a day to day basis

## Layout

An npm workspace with two packages sharing one origin in production:

| | |
|---|---|
| `src/`, `index.html`, `admin.html` | Vite + React frontend, builds to `dist/` |
| `backend/` | Express + Postgres (Drizzle) API |
| `api/index.ts` | Vercel serverless entry — exports the Express app |
| `vercel.json` | Build config and the rewrites that route `/api`, `/auth` to the function |

## Flows

Context sheets for the user-facing flows — trigger, steps, what each writes,
the invariants, and the known gaps — live in [`docs/flows/`](docs/flows/):
[onboarding](docs/flows/onboarding.md), [review](docs/flows/review.md),
[quiz](docs/flows/quiz.md).
Change the sheet in the same commit as the flow.

## Local development

```bash
npm install          # installs both workspaces
npm run dev          # frontend on :5173
npm run dev:api      # API on :8787, in a second terminal
```

Vite proxies `/api` and `/auth` to `:8787`, so requests are same-origin locally
and session cookies behave exactly as they do in production.

```bash
npm run db:migrate       # apply migrations (uses the UNPOOLED connection)
npm run db:seed-global   # seed the shared global vault
```

Backend env: copy `backend/.env.example` to `backend/.env` and fill it in. See
that file for what each variable does and which are optional.

## Deployment (Vercel)

Frontend and API deploy together to **one Vercel project**, from one origin.
That's deliberate: the session cookie is `SameSite=Lax`, so a split origin would
force `SameSite=None` and depend on third-party cookies, which browsers are
actively restricting.

- `npm run vercel-build` builds the backend (`tsc`) then the frontend (`vite build`).
  The backend must build first — `api/index.ts` imports `backend/dist/app.js`.
- `vercel.json` rewrites `/api/*`, `/auth/*` and `/health` to the single function.
  The catch-all groups are named `:vercelRest*`, and that name matters: Vercel
  appends any capture group the destination doesn't consume to the rewritten
  request **as a query parameter**. Naming the group `:path*` silently
  overwrote the app's own `?path=` on every request, so `/api/vaults/mine/note`
  looked up a note literally called `vaults/mine/note` and 404'd for every
  path. Never name a capture group after a query param the API reads.
  One function, not one per route, so middleware order (notably the raw-body
  Razorpay webhook mounted before `express.json`) and the error handler stay in
  one place.
- Vercel injects `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` when you attach a
  Postgres store; `db/client.ts` and `db/migrate.ts` read either those or the
  `DATABASE_URL*` names, so the same code runs locally and deployed.
- `CORS_ORIGINS` stays **empty** — same origin means CORS never engages.

### Required environment variables

Set these in the Vercel project (Settings → Environment Variables):

| Variable | Needed for |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | sign-in |
| `GOOGLE_REDIRECT_URI` | must be `https://<your-domain>/auth/google/callback`, and match Google Cloud Console exactly |
| `APP_URL` | where to send the user after login — `https://<your-domain>` |
| `OWNER_EMAILS` | comma-separated; these get `role=owner` on first sign-in |

Postgres vars come from the attached store. `NODE_ENV=production` is set by
Vercel automatically, which is what flips the session cookie to `Secure`.

Optional, and dormant until set: `API_KEY_ENCRYPTION_KEY` (BYO LLM keys),
`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RAZORPAY_*`. The app boots and signs in
without them; only their own routes fail.

> This used to deploy to GitHub Pages, which could only ever serve the static
> frontend — `/api/*` resolved to a 404 there, so sign-in and cloud vaults never
> worked in that deployment. That workflow has been removed.
