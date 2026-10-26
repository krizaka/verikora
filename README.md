<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/yomizaka-dark.svg">
    <img src=".github/assets/yomizaka-light.svg" alt="Yomizaka" width="96">
  </picture>
</p>

# Yomizaka

**Read before you sign.** Drop a lease, a contract, an invoice: Orazaka reads it against the law, examines the PDF for
signs of editing, and shows you every line it relies on. Keep your documents, find any clause again in a second — and
know exactly which run produced each finding.

[![CI](https://github.com/krizaka/yomizaka/actions/workflows/ci.yml/badge.svg)](https://github.com/krizaka/yomizaka/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/krizaka/yomizaka/badge)](https://scorecard.dev/viewer/?uri=github.com/krizaka/yomizaka)
[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg)](LICENSE.md)
[![dev.yomizaka.com](https://img.shields.io/badge/dev.yomizaka.com-Yomizaka-3c38b2)](https://dev.yomizaka.com)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=krizaka_yomizaka&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=krizaka_yomizaka) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=krizaka_yomizaka&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=krizaka_yomizaka) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=krizaka_yomizaka&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=krizaka_yomizaka) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=krizaka_yomizaka&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=krizaka_yomizaka) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=krizaka_yomizaka&metric=coverage)](https://sonarcloud.io/summary/new_code?id=krizaka_yomizaka)

Yomizaka (読み *yomi*, reading) is a Krizaka product in development: **sign-up is closed**, the dev site shows what it does
and a real run. The Dev preview is **web only** (phone-first); the phone app (`apps/mobile`, iOS and Android) and the Mac app (`apps/desktop`) are built beside it and are not part of it.

## What it does

- **Library** — upload PDF, Word (.docx), OpenDocument text (.odt) or plain text files (a queue that pauses, resumes and retries); each is kept as sent, its text
  layer read for search (in an isolated worker, after the upload answered 202 Accepted), its SHA-256 recorded; a file sent twice is one document.
- **Document verification** — a lease read entry by entry against the extraction matrices and technical templates of its jurisdiction
  (Québec, France, Wallonia) in force on a date, tools validated by the client's counsel: each finding gives its entry, severity, verdict,
  citation and the exact passage, highlighted in the text. Yomizaka verifies documents and screens files; it never verifies an identity.
- **Signs of editing** — a PDF or office file (.docx, .odt) examined as a file by Orazaka (metadata, dates, revision history): signals at three
  plain levels, never a score, never a "fake" stamp.
- **Search** — every document and every finding, one field (PostgreSQL full text, French and English alike).
- **Traced** — every analysis is an **Orazaka run** (the document-validation pack's Studios); its run id is kept and shown.
  Yomizaka never calls a model.
- **A signed report** — a finished check exports a report as HTML and as a signed PDF (a visible signature page, an Ed25519
  attestation); only a signed-in member the owner gave access to can verify it (`/app/verifications/report`, ADR-0002). A specimen is never signed.
- **Who it is for** — a « Pour qui ? » picker (tenant, landlord, freelancer, business, other). The tenant and the landlord have
  lease rules, the freelancer and the business have the Québec invoice check (8 rules from the federal regulation on input tax credit
  information: date, total, GST and QST numbers, taxes, payment terms); contracts say « soon » and promise nothing (`docs/product/direction-2026-10.md`). The flows behind them are
  data, administered in the database (ADR-0003).
- **Checking a tenant's application** — a consent-first flow with a provider-agnostic seam; only a demo provider answers, on dev,
  with fictitious data. No real provider is contracted yet.
- **A short public site** — the home (who it is for, one real check recorded, sign-in), sign-in and the privacy notice; nothing else is public (`docs/UX_DECISIONS.md` § 9).
- **« Forgot your password? »** — from the sign-in page: a link mailed through the mail port (the same answer whether or not the address has an account, 3 requests an hour per address), used once, valid for the `auth.passwordResetMinutes` setting (30 by default, 5 to 1440, in the administration's General group); it sets the new password and signs every session out. Needs the `MAIL_` variables; without them the link is not offered. The audit trail records each request and each reset, never an address, a link or a password.

The administration is **admin.yomizaka.com** (the same app, routed by host): people, documents, Orazaka runs, flows, operations
and an audit log of every operator action. It answers only addresses of `AUTH_ALLOWED_IPS` and an administrator's session, and is never indexed.

## API

A Pro account can run checks and batches from its own tools with an API key: `POST /api/v1/checks`, `GET /api/v1/checks/{id}`,
`POST /api/v1/batches`, `GET /api/v1/batches/{id}`, described by `GET /api/v1/openapi.json` — see [docs/API.md](docs/API.md).

## Next

Yomizaka will also check **identity documents** (photos and scans as well as PDFs) for other Krizaka products that need a
document verified before an account can be opened — served by API, analysed through Orazaka, every finding recorded with
its evidence, and a human decides anything unclear. This is not built yet: it is tracked in
[#7](https://github.com/krizaka/yomizaka/issues/7).

## Start

```bash
corepack enable && pnpm install          # Node 22, pnpm 10 — also installs the pre-push hook
cp .env.example .env                       # a local PostgreSQL URL; AI_API_KEY to run analyses
pnpm dev                                   # http://localhost:3000
pnpm run check                             # lint · typecheck · tests (what the hook and CI run)
```

## Inside

| Path | |
| :-- | :-- |
| `apps/web` | Next.js 16: the public page, sign-in (`@krizaka/ui/auth-layout`), the console (`AppShell`), the BFF (`app/api`) |
| `packages/core` | zod contracts, query keys, the report readers — shared by the API and the web |
| `scripts/check-seo-family.mjs` | the Krizaka family SEO guard, run in CI on the built site |
| `scripts/check-overflow.mjs` | the responsive crawl (dark and light, 360–1440 px, no console error), run in CI |
| `scripts/check-app-pages.mjs` | the signed-in pages rendered as the seeded persona (`E2E_EMAIL`, `E2E_PASSWORD`): exactly one `h1`, no overflow at 360–1440 px, the header's action on screen, no unnamed button — run in CI after the build (`scripts/lib/page-audit.mjs` holds what both crawls measure) |
| `scripts/check-admin-live.mjs` | the walk of the live administration from an allowed address (`pnpm run check:admin-live`) |
| `deploy/` | the Docker image and the DigitalOcean App Platform spec (`dev.yomizaka.com`) |

## Demo (the persona Éric) and the phone's Maestro flows

- `pnpm run demo:seed -- --persona eric [--reset]` seeds Éric Tremblay (landlord) with his collections, documents and seeded checks, on **dev and local only**: it refuses any `APP_ENVIRONMENT` but `dev` before it opens a connection (tested). Its login is `APP_DEMO_ACCOUNT_EMAIL` / `APP_DEMO_ACCOUNT_PASSWORD`, never typed in the repository; see `docs/demo-data.md`.
- `apps/mobile/.maestro/` holds the flows, which sign in through `shared/sign-in.yaml` with `PERSONA_EMAIL` / `PERSONA_PASSWORD`. `smoke` and `tabs` (a capture per tab: Accueil, Vérifications, Lots) are tagged `ci`; `check-document` runs a paid engine check through the system picker and is tagged `manual`.
- **In CI**, every pull request runs them on an Android emulator (`mobile-ci.yml` → the org's `mobile-e2e.yml`, krizaka/.github#241): `scripts/ci-mobile-backend.sh` starts a throwaway PostgreSQL and the built web app and seeds Éric with a password made for the run, so the demo data is reset each time and no shared account is used. The check is **`mobile-e2e / gate`**; the screenshots, the screen recording and the JUnit report are the `maestro-e2e` artifact of the run, which is where a PR's phone captures come from.
- Locally: `maestro test -e PERSONA_EMAIL=… -e PERSONA_PASSWORD=… --exclude-tags manual apps/mobile/.maestro` against a simulator signed into a dev backend.

## Environment

Every variable is declared once in `apps/web/lib/env.ts` (see `.env.example`); a test keeps this table in sync.

| Variable | Meaning |
| :-- | :-- |
| `APP_ENVIRONMENT` | `dev` or `prod`: which flows are enabled |
| `APP_PUBLIC_URL` | the public address (www.yomizaka.com: canonical links, indexed) |
| `APP_DEMO_ACCOUNT_EMAIL`, `APP_DEMO_ACCOUNT_PASSWORD` | optional credentials for the dev/local demo persona seed |
| `APP_DEV_HOST` | the development address (dev.yomizaka.com): pages go to www with a 308, the API and /.well-known keep serving, noindex |
| `APP_SEARCH_INDEXING` | `on` or `off`: `off` answers noindex everywhere |
| `APP_REPORT_SIGNING_KEY` | the Ed25519 key that signs reports |
| `DATABASE_URL`, `DATABASE_CA_CERT` | PostgreSQL (in production the PgBouncer pool `pool-yomizaka`) and its CA |
| `DATABASE_DIRECT_URL` | the database reached directly: migrations and session advisory locks need one backend; unset, `DATABASE_URL` |
| `DATABASE_MAX_CONNECTIONS` | the size of the connection pool (default 5) |
| `AUTH_SESSION_SECRET` | keys the session hashes (≥ 32 characters in production) |
| `AUTH_SIGNUP_ENABLED` | sign-up is closed unless `true` **and** the verification e-mail can be sent (the `MAIL_` variables below) |
| `PAYMENTS_PROVIDER` | the payments vendor, as a value (`stripe`) |
| `PAYMENTS_STRIPE_SECRET_KEY` | the vendor's API key (`sk_test_…` in test mode; a secret) |
| `PAYMENTS_STRIPE_WEBHOOK_SECRET` | the signing secret of the endpoint `/api/webhooks/payments` (a secret) |
| `APP_ESTIMATED_RUN_COST_CENTS` | the estimated cost of one engine run, in cents (default 3), for the pre-flight's savings metric |
| `APP_SETTINGS_ENCRYPTION_KEY` | seals a workspace's own S3 credentials in the database (AES-256-GCM, 32 bytes in base64; a secret); without it, storing credentials is unavailable |
| `APP_PURGE_AFTER_HOURS` | a document that is not kept is purged after its check; one never checked, after this many hours (default 24) |
| `MEDIA_DOCUMENTS_PROVIDER` | where a kept document lives (ADR-0007): `none` (default, nothing kept), `bunny` (development and fictional data only, refused in production) or `s3` (DigitalOcean Spaces `tor1`, a workspace's own bucket, a local test server) |
| `MEDIA_DOCUMENTS_PREFIX`, `MEDIA_DOCUMENTS_ENCRYPTION_KEY` | the prefix of every object (default `yomizaka`) and the AES-256-GCM key (32 bytes, base64; a secret) that encrypts it before it leaves |
| `MEDIA_STORAGE_ENDPOINT`, `MEDIA_STORAGE_ZONE`, `MEDIA_STORAGE_API_KEY` | the Bunny Storage zone of the `bunny` adapter (the key is a secret) |
| `MEDIA_DOCUMENTS_PULL_HOSTNAME`, `MEDIA_DOCUMENTS_TOKEN_KEY` | the zone's private pull zone and its token-authentication key (a secret): with both the store hands out signed, expiring links (dev: `yomizaka-docs-dev`) |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | the S3-compatible provider of the `s3` adapter (the last is a secret) |
| `MAIL_PROVIDER` | the e-mail vendor, as a value (`mailgun`) |
| `MAIL_API_KEY` | the vendor's key (a secret) |
| `MAIL_DOMAIN` | the sending domain |
| `MAIL_API_URL` | the vendor's API address (default `https://api.mailgun.net`) |
| `MAIL_FROM` | the sender (default `Yomizaka <no-reply@MAIL_DOMAIN>`) |
| `MAIL_WEBHOOK_SIGNING_KEY` | the key the mail provider signs its bounce and complaint webhooks with (`/api/webhooks/mail`; 404 while unset) |
| `AUTH_ALLOWED_IPS` | the addresses of the administration (empty in production = nobody) |
| `ABUSE_CLIENT_IP_HEADER`, `ABUSE_TRUSTED_PROXY_HOPS` | where the client address is read |
| `AI_PROVIDER`, `AI_API_URL`, `AI_API_KEY` | Orazaka's edge and the service key (`oz_…`) |

Rules for contributors and agents: [AGENTS.md](AGENTS.md). Security: [SECURITY.md](SECURITY.md).

## License

[FSL-1.1-ALv2](LICENSE.md) (Functional Source License, Apache-2.0 future licence) © Technologies Krizaka Inc. — read,
run, modify and self-host it for any purpose except offering a competing service; each version becomes Apache-2.0 two
years after its release. Commits before the licence change remain [Apache-2.0](LICENSE-APACHE) — see [NOTICE](NOTICE)
and [ADR-012](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-012-licensing-libraries-open-products-fair-source.md).
The Krizaka names and birds are not licensed: [trademark policy](https://github.com/krizaka/.github/blob/main/TRADEMARKS.md).
