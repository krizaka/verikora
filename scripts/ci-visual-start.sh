#!/usr/bin/env bash
# The app for the visual regression (krizaka/.github#375, the org's visual-regression.yml): the built web app on localhost:3000,
# the cast seeded (krizaka/.github#356), the moment the seed finished written to .visual-now (the browser's clock for the captures).
# PostgreSQL is the workflow's `postgres` service. Dev data only: the seed refuses anything but APP_ENVIRONMENT=dev.
set -euo pipefail
export APP_ENVIRONMENT=dev
export APP_SEARCH_INDEXING=off
export DATABASE_URL="postgresql://ci:ci-only-password@postgres:5432/ci"
export AUTH_SESSION_SECRET=ci-only-session-secret-0123456789abcdef
export AI_API_KEY=oz_ci_only_not_a_key
export PORT=3000
# The date the console writes as « today »: one day for every capture, whatever day the job runs (lib/display-now.ts; the baselines were drawn on it).
export APP_VISUAL_NOW=2026-10-30T12:00:00Z
APP_REPORT_SIGNING_KEY="$(node -e 'process.stdout.write(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"der"}).toString("base64"))')"
export APP_REPORT_SIGNING_KEY
pnpm --filter @verikora/web build
export NODE_ENV=production
# The app's declared public origin (landingRedirect requires it in production: never read from the request's Host).
export APP_PUBLIC_URL=http://localhost:3000
trap 'tail -100 web-visual.log || true' ERR
(cd apps/web && nohup npx next start -p 3000 > ../../web-visual.log 2>&1 &)
for _ in $(seq 1 90); do curl -sf http://localhost:3000/api/healthz >/dev/null && break; sleep 1; done
curl -sf http://localhost:3000/api/healthz >/dev/null
# The migrations ran at the server's start; now the cast (Éric, Mira, Camille), idempotent.
APP_DEMO_ACCOUNT_EMAIL=eric@demo.verikora.test APP_DEMO_ACCOUNT_PASSWORD=ci-only-demo-password-0123 node scripts/demo-seed/cli.mjs --cast --reset --check
date -u +%Y-%m-%dT%H:%M:%SZ > .visual-now
echo "ready: http://localhost:3000 (dev, the cast seeded)"
