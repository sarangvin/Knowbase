# knowbase-backend

M1–M5, the full planned milestone set: Google auth, personal + global cloud
vaults, BYO/free/pro AI tiers, Razorpay billing, and usage tracking + an admin
view. See `../../.claude/plans` (or ask) for the plan this was built against.

## Setup

1. `cp .env.example .env` and fill in:
   - `DATABASE_URL` — a Postgres instance (local `postgres` via Docker/Homebrew is fine for dev).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — create an OAuth 2.0 Client ID
     (Web application) in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
     Add `http://localhost:8787/auth/google/callback` as an Authorized redirect URI.
   - `OWNER_EMAILS` — your own Google account email, so your first sign-in gets `role='owner'`.
   - `API_KEY_ENCRYPTION_KEY` — 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - `GEMINI_API_KEY` — your own key from aistudio.google.com/apikey, powers the free Gemma tier
     (via Google's Generative Language API — not Groq, which dropped every Gemma model from
     its catalog). `GEMINI_MODEL` is optional, defaults to `gemma-3-27b-it`.
   - `ANTHROPIC_API_KEY` — your own Anthropic key, powers the paid Pro tier's model.
   - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from dashboard.razorpay.com → Settings → API Keys.
   - `RAZORPAY_PLAN_ID` — create a monthly Plan once under Subscriptions → Plans for the Pro tier's price.
   - `RAZORPAY_WEBHOOK_SECRET` — set when you add the webhook URL
     (`https://<your-api-domain>/api/billing/webhook`) under Settings → Webhooks;
     enable `subscription.activated`, `subscription.charged`, `subscription.cancelled`,
     `subscription.completed`, `subscription.expired`. Google Pay shows up automatically
     in Razorpay's Checkout for supported devices/browsers — nothing extra to configure.
2. `npm install`
3. `npm run db:generate` — generates SQL migrations from `src/db/schema.ts` into `drizzle/`.
4. `npm run db:migrate` — applies them to `DATABASE_URL`.
5. `npm run db:seed-global` — seeds the global vault from `../public/vault/`.
6. `npm run dev` — starts the API on `:8787` (or `$PORT`).

## Notes

- Sessions are opaque IDs in an httpOnly cookie, backed by a `sessions` table —
  revoking a session (or all of a user's sessions) is a single `DELETE`, unlike
  a self-contained JWT.
- `vault_id` is always derived from the session server-side in `routes/vaults.ts`
  — never trust a client-supplied vault or user id. This is the tenant-isolation
  boundary; don't add a route that accepts either as a request parameter.
- Run the frontend (`../`) with `npm run dev` — its Vite dev server proxies
  `/api` and `/auth` to this backend so cookies are same-origin locally, matching
  the same-site setup planned for production.
- Every async route handler must be wrapped in `middleware/asyncHandler.ts` —
  Express 4 doesn't catch rejections from async handlers itself, and an
  uncaught one crashes the entire Node process (verified against this
  codebase, not theoretical). The global error middleware at the end of
  `app.ts` is the backstop, but the wrapper is what gets errors there.
- `subscriptions` is written only by `billingWebhookHandler` in
  `routes/billing.ts` — `/subscribe` and `/cancel` only ask Razorpay to
  start/stop a subscription, they never set `status`/`plan_tier` themselves.
  Plan changes are always asynchronous from the client's point of view.
- `usage_events` is append-only and best-effort — `usage/logEvent.ts` swallows
  its own errors so a logging failure never breaks the request it's
  describing. The admin app (`../admin.html`, requireOwner-gated, its own
  separate Vite bundle) reads aggregates off it via `routes/admin.ts`.
