#!/usr/bin/env bash
# Runs after the production build (the org's node-ci `after-build`; the repository root is the working directory):
# the SEO family contract on the built site, the responsive guard in a real browser, sign-up closed.
set -euo pipefail
export NODE_ENV=production
# The app's declared public origin (landingRedirect requires it in production: never read from the request's Host).
export APP_PUBLIC_URL=http://localhost:3000
export AUTH_SESSION_SECRET=ci-only-session-secret-0123456789abcdef
export AI_API_KEY=oz_ci_only_not_a_key
export PORT=3000
# A throwaway signing key for this run only (a production server refuses to start without one).
APP_REPORT_SIGNING_KEY="$(node -e 'process.stdout.write(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"der"}).toString("base64"))')"
export APP_REPORT_SIGNING_KEY
trap 'tail -100 web.log || true' ERR
(cd apps/web && pnpm exec next start -p 3000 > ../../web.log 2>&1 &)
for _ in $(seq 1 60); do curl -sf http://localhost:3000/api/healthz && break; sleep 1; done
pnpm run seo:check
# The brand icons and their lock = the CDN manifest (the unit test checks icons = lock offline).
node scripts/sync-brand-icons.mjs --check
# Responsive guard: no horizontal overflow at 360-1440 px in both themes, chips of at least 44 px.
pnpm run check:overflow -- --base http://localhost:3000   # also axe-core WCAG 2.1 AA, ratcheted by a11y-baseline.json (--a11y-update lowers it)
node scripts/check-home-first-screen.mjs --base http://localhost:3000
# The 404 is a page in the language of the address (the UX review's Y10): its status and its words.
test "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/fr/nope)" = "404"
curl -s http://localhost:3000/fr/nope | grep -q "Retour à la bibliothèque"
curl -s http://localhost:3000/en/nope | grep -q "Back to the library"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/auth/sign-up)" = "403"
# The signed-in pages, rendered as the seeded persona Éric (the demo data set of scripts/demo-seed, CI-only credentials, never a
# real account): exactly one h1 each, no horizontal overflow at 360-1440 px, the header's action on screen, no unnamed button, axe-core (a11y-baseline.app.json).
APP_DEMO_ACCOUNT_EMAIL=eric@demo.verikora.test APP_DEMO_ACCOUNT_PASSWORD=ci-only-demo-password-0123 node scripts/demo-seed/cli.mjs --cast --check
# The layout audit proves itself on its own fixtures first (a card out of its panel, sections on top of each other, a cut column).
pnpm exec krizaka-page-audit --self-test
E2E_EMAIL=eric@demo.verikora.test E2E_PASSWORD=ci-only-demo-password-0123 node scripts/check-app-pages.mjs --base http://localhost:3000
E2E_EMAIL=eric@demo.verikora.test E2E_PASSWORD=ci-only-demo-password-0123 node scripts/check-signed-in-landing.mjs --base http://localhost:3000
