#!/usr/bin/env bash
# The backend of the phone's Maestro flows (krizaka/.github#241, mobile-e2e.yml's `setup-command`; krizaka/verikora#346):
# a throwaway PostgreSQL and the built web app on localhost:3000, with the persona Éric seeded for DEMO_ACCOUNT_EMAIL /
# DEMO_ACCOUNT_PASSWORD (made by the workflow, masked, for this run only). A fresh database every run, so the demo data is
# always reset. The emulator reaches it through `adb reverse`. Dev only: the seed refuses anything but APP_ENVIRONMENT=dev,
# and nothing here is a real secret or a real account.
set -euo pipefail
# DEMO_LOCALE (en | fr, default fr) is the language of the persona's data: a film shows English fixtures on /en, French ones on /fr
# (verikora#1968). `ci-mobile-backend.sh reseed <locale>` seeds the running database again in the other language (the web films).
LOCALE="${DEMO_LOCALE:-fr}"
case "$LOCALE" in en|fr) ;; *) echo "DEMO_LOCALE must be en or fr" >&2; exit 1 ;; esac
: "${DEMO_ACCOUNT_EMAIL:?DEMO_ACCOUNT_EMAIL is required}"
: "${DEMO_ACCOUNT_PASSWORD:?DEMO_ACCOUNT_PASSWORD is required}"

if [[ "${1:-}" == "reseed" ]]; then
  LOCALE="${2:?usage: ci-mobile-backend.sh reseed <en|fr>}"
  DB_PASS="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' e2e-pg | sed -n 's/^POSTGRES_PASSWORD=//p')"
  echo "::add-mask::$DB_PASS"
  APP_ENVIRONMENT=dev DATABASE_URL="postgresql://verikora_db:${DB_PASS}@localhost:5432/verikora_db" \
    APP_DEMO_ACCOUNT_EMAIL="$DEMO_ACCOUNT_EMAIL" APP_DEMO_ACCOUNT_PASSWORD="$DEMO_ACCOUNT_PASSWORD" \
    node scripts/demo-seed/cli.mjs --cast --reset --locale "$LOCALE"
  echo "reseeded in $LOCALE"
  exit 0
fi

DB_PASS="$(openssl rand -hex 16)"
echo "::add-mask::$DB_PASS"
docker run -d --name e2e-pg -p 5432:5432 -e POSTGRES_USER=verikora_db -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB=verikora_db postgres:16 >/dev/null
for _ in $(seq 1 60); do docker exec e2e-pg pg_isready -U verikora_db >/dev/null 2>&1 && break; sleep 1; done

export APP_ENVIRONMENT=dev
export APP_SEARCH_INDEXING=off
export DATABASE_URL="postgresql://verikora_db:${DB_PASS}@localhost:5432/verikora_db"
export AUTH_SESSION_SECRET="$(openssl rand -hex 32)"
export AI_API_KEY=oz_ci_only_not_a_key
export PORT=3000
APP_REPORT_SIGNING_KEY="$(node -e 'process.stdout.write(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"der"}).toString("base64"))')"
export APP_REPORT_SIGNING_KEY

pnpm --filter @verikora/web build
export NODE_ENV=production
# The app's declared public origin (landingRedirect requires it in production: never read from the request's Host).
export APP_PUBLIC_URL=http://localhost:3000
trap 'tail -100 web-mobile-e2e.log || true' ERR
(cd apps/web && nohup npx next start -p 3000 > ../../web-mobile-e2e.log 2>&1 &)
for _ in $(seq 1 90); do curl -sf http://localhost:3000/api/healthz >/dev/null && break; sleep 1; done
curl -sf http://localhost:3000/api/healthz >/dev/null

# The migrations ran at the server's start; now the persona (idempotent, refused outside dev).
APP_DEMO_ACCOUNT_EMAIL="$DEMO_ACCOUNT_EMAIL" APP_DEMO_ACCOUNT_PASSWORD="$DEMO_ACCOUNT_PASSWORD" node scripts/demo-seed/cli.mjs --cast --reset --locale "$LOCALE" --check
echo "backend ready: http://localhost:3000 (dev, persona Éric)"
