#!/usr/bin/env bash
# Post-deploy validation for Rabbithole (KnowBase). See docs/validation.md for
# what each check is for and how to read a failure.
#
#   scripts/validate-deploy.sh [commit-sha]     (defaults to HEAD)
#
# Safe to run against production: the API probes are unauthenticated and the
# database checks are read-only (default_transaction_read_only = on). Needs
# .env.vercel (prod DB URL) for section 5 and backend/.env for section 6;
# a section whose input is missing is reported as SKIP, not as a pass.
set -u
cd "$(dirname "$0")/.."
SHA="${1:-$(git rev-parse --short HEAD)}"
PROD="${PROD_URL:-https://rabbithole-topaz.vercel.app}"
REPO="sarangvin/Knowbase"
fail=0; skip=0
pass() { echo "PASS  $1"; }
bad()  { echo "FAIL  $1${2:+  ($2)}"; fail=$((fail+1)); }
skp()  { echo "SKIP  $1${2:+  ($2)}"; skip=$((skip+1)); }
ok()   { if [ "$2" = "1" ]; then pass "$1"; else bad "$1" "${3:-}"; fi; }

echo "== 1. Static: types, lint, build, pure rules =="
npx tsc -b >/dev/null 2>&1 && pass "frontend+backend typecheck (tsc -b)" || bad "typecheck"
npx oxlint src backend/src 2>&1 | grep -q "Found 0 warnings and 0 errors\|0 errors" && pass "oxlint: 0 errors" || {
  # oxlint exits 0 on warnings; only errors fail this check.
  npx oxlint src backend/src >/dev/null 2>&1 && pass "oxlint: no errors" || bad "oxlint errors"; }
npm run build >/dev/null 2>&1 && pass "production build" || bad "production build"
DATABASE_URL=postgres://x@localhost/none npx tsx scripts/streak-rules.mts > /tmp/rules.$$ 2>&1 \
  && pass "streak/limits/model-chain rules ($(grep -c '^PASS' /tmp/rules.$$) checks)" \
  || { bad "rule checks"; grep '^FAIL' /tmp/rules.$$; }
DATABASE_URL=postgres://x@localhost/none npx tsx scripts/study-rules.mts > /tmp/rules.$$ 2>&1 \
  && pass "study-data rules ($(grep -c '^PASS' /tmp/rules.$$) checks)" \
  || { bad "study rule checks"; grep '^FAIL' /tmp/rules.$$; }
rm -f /tmp/rules.$$

echo "== 2. Deploy status for $SHA =="
state=""
for _ in $(seq 1 30); do
  state=$(gh api "repos/$REPO/commits/$SHA/status" --jq '.state' 2>/dev/null)
  [ -n "$state" ] && [ "$state" != "pending" ] && break
  sleep 10
done
ok "Vercel deployment status is success" "$([ "$state" = success ] && echo 1 || echo 0)" "state=${state:-none}"

echo "== 3. Production serves this build =="
for page in "" admin.html; do
  local_assets=$(grep -oE 'assets/[A-Za-z0-9._-]+\.(js|css)' "dist/${page:-index.html}" | sort -u)
  live_assets=$(curl -s "$PROD/$page" | grep -oE 'assets/[A-Za-z0-9._-]+\.(js|css)' | sort -u)
  ok "${page:-index.html} references the same hashed assets as the local build" \
     "$([ -n "$local_assets" ] && [ "$local_assets" = "$live_assets" ] && echo 1 || echo 0)" \
     "local=[$local_assets] live=[$live_assets]"
done

echo "== 4. Production API, unauthenticated =="
code() { curl -s -o /dev/null -w '%{http_code}' "$PROD$1"; }
ok "GET /api/vaults -> 401"            "$([ "$(code /api/vaults)" = 401 ] && echo 1 || echo 0)"
ok "GET /api/account/streak -> 401"    "$([ "$(code '/api/account/streak?day=2026-01-01')" = 401 ] && echo 1 || echo 0)"
ok "GET /api/onboarding/jobs -> 401"   "$([ "$(code /api/onboarding/jobs)" = 401 ] && echo 1 || echo 0)"
ok "GET /api/admin/usage -> 403 (not owner)" "$([ "$(code /api/admin/usage)" = 403 ] && echo 1 || echo 0)"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$PROD/api/llm/free/chat")
ok "POST /api/llm/free/chat -> 401"    "$([ "$c" = 401 ] && echo 1 || echo 0)" "got $c"

echo "== 5. Production database (read-only) =="
if [ -f .env.vercel ] && command -v psql >/dev/null; then
  DB=$(grep -E '^DATABASE_URL_UNPOOLED=' .env.vercel | cut -d= -f2- | tr -d '"')
  q() { psql "$DB" -Atq -c "SET default_transaction_read_only = on" -c "$1" 2>/dev/null | tail -n +1 | grep -v '^SET$'; }
  cols=$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name IN ('access_approved_by','access_revoked_at')")
  ok "migration 0018: users.access_approved_by and access_revoked_at exist" "$([ "$cols" = 2 ] && echo 1 || echo 0)" "found $cols of 2"
  revoked=$(q "SELECT count(*) FROM users WHERE access_revoked_at IS NOT NULL")
  ok "no account is marked revoked unless the owner revoked it (expect 0 right after deploy)" "$([ "$revoked" = 0 ] && echo 1 || echo 0)" "revoked=$revoked"
  bad_approvals=$(q "SELECT count(*) FROM users WHERE access_approved AND access_approved_by IS NULL AND access_approved_at > now() - interval '1 hour' AND role <> 'owner'")
  ok "no account approved in the last hour without a recorded approver" "$([ "$bad_approvals" = 0 ] && echo 1 || echo 0)" "n=$bad_approvals"
  echo "INFO  accounts: $(q "SELECT count(*) FILTER (WHERE access_approved) || ' approved, ' || count(*) FILTER (WHERE NOT access_approved) || ' new, ' || count(*) FILTER (WHERE access_approved_by='streak') || ' graduated by streak' FROM users WHERE role = 'user'")"
  echo "INFO  llm calls since last midnight Pacific that fell back: $(q "SELECT count(*) FROM usage_events WHERE event_type='llm_call' AND created_at > now() - interval '24 hours' AND jsonb_typeof(metadata->'fellBackFrom')='array'")"
else
  skp "database checks" ".env.vercel or psql missing"
fi

echo "== 6. Gemini model chain is available to the key =="
if [ -f backend/.env ] && grep -q '^GEMINI_API_KEY=.' backend/.env; then
  KEY=$(grep '^GEMINI_API_KEY=' backend/.env | cut -d= -f2- | tr -d '"')
  listing=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=$KEY")
  for m in gemini-3.5-flash-lite gemini-3.1-flash-lite; do
    echo "$listing" | grep -q "\"models/$m\"" && pass "$m is listed for the key" || bad "$m is not listed for the key"
  done
  r=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
      -d '{"contents":[{"role":"user","parts":[{"text":"Say ok."}]}]}' \
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=$KEY")
  ok "primary model answers a live request" "$([ "$r" = 200 ] && echo 1 || echo 0)" "http $r (a 429 means the day's quota is spent, which the chain is for)"
else
  skp "model chain checks" "no GEMINI_API_KEY in backend/.env"
fi

echo
[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED ($skip skipped)" || echo "$fail CHECK(S) FAILED ($skip skipped)"
exit $((fail > 0))
