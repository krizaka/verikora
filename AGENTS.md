# Yomizaka — agent contract

> Governance of **`krizaka/yomizaka`**: Yomizaka, a Krizaka product — documents (leases, contracts, invoices) kept,
> read, checked and searched. **Every analysis is an Orazaka run.** Agent-neutral: humans and AI agents follow the same rules.

## 1. What this repository is

- The public site is **three pages** (Simplify Yomizaka, #120): the home, sign-in and the privacy notice; the menu is `lib/nav.ts`, the removed addresses are `lib/removed-urls.mjs` (308), `lib/menu.test.ts` guards both. Never add a marketing page back: change the home.
- **One language of addresses** (yomizaka#389): the signed-in space's addresses are English (`/app/search`, `/app/check`, `/app/check/batches`, `/app/library`, `/app/welcome`, `/app/verifications/report`); the French ones answer 308 from `lib/removed-urls.mjs` (with and without the language), never from a page. `/download` is parked (308 to the home, out of the footer and the sitemap) while `lib/downloads.ts` has no link; `lib/menu.test.ts` keeps the two in step.
- **Docs and pricing** (yomizaka#387, #388): `/docs` documents the product on the docs template (the API reference is generated from `lib/api-v1/openapi.ts`); `/pricing` reads the price catalogue on the pricing template, no price typed, what is not built "soon" with no figure, never a charge the code does not make (#373). `/pricing` is HELD behind `PRICING_PUBLISHED` (`lib/prices/publication.ts`) until Oussama approves the price grid (#300): 404, and out of the bar, footer, sitemap and llms.txt (`lib/listed.ts`).
- A **pnpm + Turborepo** monorepo: `apps/web` (Next.js 16: the public page, sign-in, the console and the BFF — route
  handlers are the only HTTP surface) and `packages/core` (zod contracts the API answers with and the web reads, the
  query keys, the pure helpers). One product = one repository (`krizaka/<product>`).
- **Built only from Krizaka bricks**: `@krizaka/ui` (auth-layout, app-shell, product-page, data-table, form, file-upload
  with its pacer queue, search-field, tabs…), `@krizaka/query`, `@krizaka/i18n`, `@krizaka/icons`, `@krizaka/tokens`
  (`brands/yomizaka.css`). A missing generic component is added to krizaka-ui, released, then used — never copied here.
  No `@tanstack/*` import (only through `@krizaka/*`), no `fetch` in a client `useEffect` (Server Components and
  `@krizaka/query`), no hand-written `<table>` or multi-field `<form>`.

## 2. Orazaka does the analysis — never this repository

- Yomizaka **never calls a model** and never judges a document itself. Compliance (a lease against a jurisdiction's
  rules) and authenticity (a PDF examined as a file) are the Studios of Orazaka's `document-validation` pack, called on
  `AI_API_URL` (`https://dev.orazaka.com/edge`) with the service key `AI_API_KEY` (`oz_…`, created by Orazaka's
  `node scripts/dev-deploy.mjs service-account yomizaka --studios compliance-check,document-authenticity --out …`, stored
  in DigitalOcean as a SECRET). `lib/orazaka.ts` is the only client.
- **Every analysis keeps its Orazaka run id**, shown in the UI: the trace of what ran, on which Studio version.
- Reading a file's **text layer** (pdf.js through `unpdf`) is parsing, not analysis: it feeds the compliance Studio and
  search. A scanned PDF has no text layer — the UI says so; reading images would be Orazaka's job. pdf.js never runs in the web
  process: `lib/extraction/isolated.ts` reads the PDF in a `node:worker_threads` worker with its own heap (384 MB), a 10 s deadline
  and a 150-page ceiling (one warm worker serves the files one after the other, renewed every 50 files and after any failure; pdf.js loads once), so a heavy or hostile file ends the worker, not the container (`deploy/docker/smoke/pdf.cjs` proves it in the image). `POST /api/documents` answers **202 Accepted** `QUEUED` for a new PDF or text file: the row is saved at
  once (`documents.extraction`: queued → running → done | failed, with `extraction_error`), the worker reads it after the answer, a check waits (`409 EXTRACTING`),
  `@yomizaka/client`'s `uploadDocument` and the web's `startIfSure` wait for `done` (`waitForExtraction`, `packages/core`), the document page polls. A reading left
  queued or running for 3 minutes (the process restarted) shows as failed.
  search. A scanned PDF has no text layer — the UI says so; reading images would be Orazaka's job.
- **The TAL renewal radar** (`lib/brief/`, yomizaka#228): Yomizaka's first detector of the Monday brief, on `@krizaka/brief` (`renewalRadar`, pure). The notice
  windows of art. 1942 C.c.Q. and the TAL's yearly figures are **data** (`content/tal/renewal-radar.json`: one entry per year, each with its source page and the day
  it was entered; no year, no figure — the radar says so and shows the table's source). Never a percentage in code, never an invented figure: the shipped table has
  no year until the TAL's are entered. `renewalNotice` writes the document the manager signs and sends: Yomizaka sends nothing on anyone's behalf. The lease
  portfolio that feeds it (doors, buildings, costs) is yomizaka#126.
- **The signed PDF is paper** (design § 3.2, P13): a folio « n / total » first on every page, the findings in the screen's order and with its numbers
  (`numberFindings`), the review note and the contract's non-check as footnotes at the foot of the first page (¹ ²). The folios are not part of the
  signed text; verification checks that each page starts with the folio of its place (a moved page is `ALTERED`).
- A report is shown as Orazaka returned it (`packages/core` `reportOf`): a shape it did not send is `null`, never a guess.
  The home's proof shows **the recorded tenant run**; the landlord's is kept beside it: a fictitious sample lease sent to Orazaka's compliance Studio on dev (Québec ruleset), the answer kept exactly as Orazaka returned it in `apps/web/content/recorded-runs/<side>.json` — written by `scripts/record-runs.mjs` (key from the environment, never by hand; re-run it when the ruleset or the Studio changes). `lib/recorded-runs.ts` validates both at build: a page without a recorded run does not build (`lib/recorded-runs.test.ts`). The platform's own showcase (an administrator promotes a check on a sample document, `lib/showcase.ts`, `/api/showcase/*`) stays available but the page no longer depends on it.

## 3. The product is independent

- No link to another Krizaka product, no family switcher, no family columns in the footer. Krizaka is the publisher,
  named **only in the footer** ("A Krizaka product" → www.krizaka.com) and the legal mentions. Orazaka is named as the
  engine in words (it is the point), never as a link.
- The colour is the Yomizaka brand of `@krizaka/tokens` (ink indigo), the mark `YomizakaLogo`, the bird the owl ("reads
  and knows every face"). Components use `--kz-*` roles only; dark and light are first-class (dark by default).

- **The mobile app lives in `apps/mobile`** (2026-10-22: the three products go on iOS, Android and the Mac). The Dev preview of Yomizaka stays **web only**, phone-first (decision 2026-10-17: mobile later, and then with the
  family's mobile standards). `mobile.build` and `mobile.ux-review` of the Dev preview checklist are `na` for that reason.

## 4. Security of the dev environment

- **Sign-up is open for Yomizaka only (decision of Oussama, 2026-10-21; every other Krizaka product stays closed).** It is
  still closed server-side unless `AUTH_SIGNUP_ENABLED=true` **and** the verification e-mail can be sent (the `MAIL_`
  variables, `signupOpen()` in `lib/env.ts`): otherwise `/api/auth/sign-up` answers 403 `SIGNUP_CLOSED`. An account is
  created unverified; a mailed single-use link (24 h, keyed hash) confirms the address (a button, a POST, so a mail scanner
  cannot spend it); sign-in is refused (`EMAIL_NOT_VERIFIED`) until then. The terms and the privacy notice (Loi 25) must be
  accepted; their version and date are kept (`terms_version`). Abuse limits: per client address and per e-mail, one free
  audit per account. `/terms` and the privacy notice are drafts until a member of the Barreau du Québec has read them; the points
  for that reading (refunds, liability, transfers outside Québec) are listed in the `lawyer-review` issues, not in the copy. Every report and page says
  « Vérification informative, ce n'est pas un avis juridique » and never uses « conforme » as a guarantee. The QA accounts of
  `company/QA.md` still exist (`apps/web/scripts/qa-accounts.mjs`, passwords from the environment, never printed).
- The administration lives on **admin.yomizaka.com** (same app, host-routed by `proxy.ts`/`lib/host.ts` to `app/[locale]/(admin)/console`, never indexed; 404 on dev.yomizaka.com) and `/api/admin/*`; it needs a session, the ADMIN role **and** an address of
  `AUTH_ALLOWED_IPS` (empty in production = nobody); a failed lock is a 404 on pages, a 403 on the API.
- The audit trail is `@krizaka/audit` (`lib/audit.ts`, table `audit.entry`, migration 0037; `audit_log` stays one release as a view, dropped in a follow-up). An action id is `[a-z0-9_]` segments joined by dots (`applicant_file.closed`, never a hyphen); `audit()` never throws, `auditIn(tx, …)` joins the caller's transaction.
- Passwords, sessions, the client address and the administration's locks are `@krizaka/auth` (bound in `lib/session.ts`, `lib/access.ts`, `clientAddress` of `lib/env.ts`; no copy of `password.ts`/`client-ip.ts`): scrypt; sessions: random tokens (`ys1.…`) kept as keyed hashes (`AUTH_SESSION_SECRET`), their length the setting `auth.sessionDays`, HttpOnly cookies; `GET /api/me` is the family's contract (200 `{ signedIn, signupOpen, account? }`, `private, no-store`); rate limits
- Audit credits are `@krizaka/credits`'s ledger (`lib/audit-credits.ts`, tables `credits.*`, migration 0050; `accounts.audit_credits` and `free_audit_used_at` stay one release, no longer read). A paid credit is a purchased pot, the free first audit a granted pot (`free-audit`, `audit.freeValidDays`) that falls back to purchased credits; `reserveAudit` / `releaseAudit` / `refundFailedAudit` keep their outcomes and codes (`PAYWALL`, `DAILY_LIMIT`, `FAIR_USE`). The ledger's owner key is dropped (0050): erasing an account leaves its lines under a bare id. A webhook is applied in one transaction (`applyPaymentEvent`, `payment_events` stays in `public.payment_events` for now).
- Consents, the export and the erasure are `@krizaka/privacy` (`lib/privacy.ts`, tables `privacy.*`, migration 0051; the `consents` table stays one release, no longer read). A flow's consent key is a purpose (`lib/consent-purpose.ts`: a key not starting with a letter is stored as `k-<md5>`); a grant records the flow's version as the notice. The export is one document with a part per module (`yomizaka`, `screenings`, `credits`, `consents`, `audit`); an erasure runs every module in one transaction, the identity last, withdraws the consents and records the request (`privacy.request`, no name). The applicant's consents (`application_consents`, screening) are not moved yet. No purpose declares a retention yet (`privacy.retention.<purpose>Days` is read when one does).
  on sign-in, upload, analysis and search (`@krizaka/rate-limit` through `lib/limits.ts`; every number is a setting `limits.<action>.perIp|perSubject|windowSeconds`, defaults in `lib/settings/limits.ts`); security headers (CSP same-origin, HSTS, nosniff, frame-ancestors self).
- A production server refuses to start without `DATABASE_URL`, `AUTH_SESSION_SECRET` (≥ 32), an `oz_` key and, for a TLS
  database, its CA (`lib/env.ts`). Secrets only in DO as SECRET and in the maintainer's local files — never in the
  repository, never printed (read them with `~/.krizaka-worktrees/tools/secret.sh`).
- Environment variables are named by bounded context (`APP_`, `DATABASE_`, `AUTH_`, `ABUSE_`, `AI_`), never by product or
  vendor; each is declared once in `apps/web/lib/env.ts`.

- **The live DO spec must equal `deploy/digitalocean/dev.app.yaml`** (the repository is the intent; `doctl apps update` is not run by CI). The sitemap was a 404 because the live app still had `APP_SEARCH_INDEXING=off` while the file said `on`: after any spec change, run `node scripts/check-seo-family.mjs --base https://www.yomizaka.com --host https://www.yomizaka.com`. **`dev.*` is never indexed** (www is production; dev redirects to it today and becomes a separate dev environment later): `indexableOn` is false for any `dev.*` host, tested in `lib/indexing.test.ts`.

## 5. Storage and cost

- Documents (≤ 10 MB) are kept **in the database** (`documents.content`, bytea) for the MVP: no storage service to pay
  for or secure. Database `yomizaka_db` on the shared dev cluster `krizaka-dev-pg` (its own role, trusted source = the
  app). Migrations are code (`lib/migrations.ts`), applied at start by `@krizaka/db`'s `migrate` under an advisory lock (key 73191, history `schema_migrations`; on `DATABASE_DIRECT_URL`); a deployed migration is never
  edited. The Krizaka modules whose tables pre-date the package are adopted (markers only, `lib/modules.ts`, migration 0036) and `assertModules` runs at boot.
- Deployed on DigitalOcean App Platform, project `yomizaka`, the smallest service (`apps-s-1vcpu-0.5gb`, $5/month),
  `dev.yomizaka.com`. Budget mode: nothing recurring above that without a written decision.

## 6. Checks — local first, CI always

- **Before every push**, the local check: `pnpm run check` (lint · typecheck · tests). The pre-push hook
  (`.githooks/pre-push`, installed by `pnpm install`) runs it, and `.githooks/pre-commit` runs the ast-grep ratchet on staged TypeScript; never push "to see what CI says".
- CI (`.github/workflows/ci.yml`): lint (ESLint, i18n catalogues), typecheck, unit tests, production build, the SEO family
  guard on the built site, and CodeQL. Never merge with a pending or red check.
- **No test, not done**: every feature and every fix ships with its tests (a fix starts with a failing test). Pure logic
  lives where a test reaches it (`packages/core`, `apps/web/lib`).
- Every visible page is checked in dark and light, desktop and phone, before it is announced. PR captures go to Bunny
  (`pr-assets/yomizaka/…`, krizaka-com `scripts/pr-assets.mjs`), never into the repository.
- Each notable UX choice has its entry in `docs/UX_DECISIONS.md`.

## 7. Text

- Every user-facing string is in `apps/web/messages/{en,fr}.json` (English is the reference; `krizaka-i18n check` in
  `pnpm lint`). Never choose a text with a locale ternary. Orazaka's reports are in French, the language of their rules:
  the UI says so.

## Static rules & codemods (ast-grep)

The org code rules (addendum 2026-10-15) are lint rules, not review comments. [`@ast-grep/cli`](https://ast-grep.github.io)
is a **pinned devDependency** (no global install, CI reproduces local): `sgconfig.yml` + `rules/*.yml` (one rule per file,
with a message and, where safe, a `fix:`; written for Tsx and `.ts` is parsed as Tsx too, so each rule covers `.ts` and `.tsx`), `rule-tests/` (valid/invalid cases of each rule).

| Rule | What it refuses |
| :--- | :--- |
| `no-hand-ms-*`, `no-get-time-difference`, `no-get-time-arithmetic` | hand-written time arithmetic (`n * 60 * 1000`, `a.getTime() - b.getTime()`): date-fns, or a duration read from the settings |
| `no-env-in-domain` | an `env` import in domain code (`packages/*/src`, `src/`): the value arrives as a parameter |
| `no-db-in-service-or-rules` | a db client / schema import in `*.service.ts`, `*-service.ts`, `*.rules.ts`, `*-rules.ts` |
| `no-ts-enum` | the TypeScript `enum` keyword (`as const` object + derived type, or a Postgres enum) |
| `no-enum-string-compare` | `x.status === "OPEN"` (field named status/kind/role/reason/state/direction compared to a string literal) |
| `no-ambient-clock` | `new Date()` / `Date.now()` in domain code: the clock is injected |
| `no-types-at-package-root` | `types.ts` at a package root (`<feature>/<feature>.types.ts`) |
| `no-unjustified-numeric-export` | a numeric (or `…ToMilliseconds(n)`) `export const` in feature code without `// @fixed: <reason>` just above |
| `no-direct-organize-write` | a hand-written `INSERT`, `UPDATE` or `DELETE` on the `organize` schema (tags, decisions, views, configuration) outside the migration: write through `createWorkspace` (`lib/workspace/service.ts`), which holds the roles, the row locks, the 200-entity ceiling and one audit line per entity (yomizaka#324) |
| `no-hand-made-nav`, `no-hand-made-language-switch` | a navigation bar that is not `NavBar` of @krizaka/ui (own Radix NavigationMenu, a local `NavBar`/`TopNav`), a hand-made language switch (`hrefLang` in a component, a row of `aria-pressed={locale === …}` buttons): use `NavBar` and `NavBar.Language` (« Navigation in the family », ui.krizaka.com) |

- **Run**: `npm run lint` runs everything (it includes `ast-grep test` and the ratchet). `npx ast-grep scan` lists the
  violations with their message; `npm run lint:sg:test` runs the rule tests.
- **Shared rules** (`@krizaka/config`, krizaka/.github#232): `apps/web` lints with the UI rules, `krizakaStack()` and `noLocaleTernary()`
  (tests may compare locales); `apps/mobile` lints with `krizakaBase`. `.dependency-cruiser.cjs` (« Krizaka first », no cycle, no
  unresolvable import, no dev dependency in production code) runs in each app's `lint` through `krizaka-known-violations check`;
  the violations recorded in `.dependency-cruiser-known-violations.json` only go down (`krizaka-known-violations update` locks a gain).
- **Ratchet**: `scripts/sg-ratchet.mjs` counts the violations per rule and refuses any increase against
  `sg-ratchet.json` (same idea as `krizaka-ratchet` / `lint-ratchet.json`: the debt only goes down). Fixed some? Lock the gain with
  `npm run sg:ratchet:update` (it never raises a count and records a new rule at its current count). A new rule is
  added with its test in `rule-tests/` and its baseline in the same pull request. The script is identical in every
  Krizaka TypeScript repository (keep the copies identical; its unit test is `scripts/sg-ratchet.test.mjs`).
- **Codemods**: `npm run sg:fix` applies the `fix:` of the rules (`ast-grep scan --update-all`) and adds the date-fns import;
  behaviour is identical — run `npm run lint && npm test` after, and land the result in a small pull request.
- A rule is never silenced to get a PR green; fix the code, or (a business parameter that is a technical fact) justify it with `// @fixed:`.

## Before you open or update a pull request (coding agents)

These are the defects code review found most often on 2026-10-23. Check them yourself before you open or update a pull request:
1. **Checks:** run the repository's full check (lint, typecheck, tests, build) and fix it. Never push a red check.
2. **Concurrency:** any « count then insert » or « check then write » runs in one transaction with a lock, and has a concurrency test.
3. **One gate:** a rule (limit, permission, validation) is enforced in the service, so no route can skip it. Test every route.
4. **Errors:** a cleanup (ROLLBACK, DROP, close) never masks the original error. Rethrow it, or throw an `AggregateError` with the original first.
5. **Validation:** validate the original input, never a truncated or pre-trimmed copy. Server and client reject the same inputs.
6. **Accessibility:**
   - every control has a unique label, and FR/EN pairs say their language;
   - focus rings are never clipped by `overflow`;
   - text never overflows its box at 360 px.
7. **Naming:** environment variables follow `<CONTEXT>_<THING>` (`APP_`, `DATABASE_`, `AUTH_`, `MEDIA_`, `MAIL_`, `PAYMENTS_`, `AI_`…) and are declared once.
8. **Words:** every user-facing string is in the FR and EN messages, and no colour is hard-coded.
9. **Review threads:** answer every one. Fix it test-first, or reply with the reason, then resolve it.

- **A bug means a missing guard** ([standard](https://github.com/krizaka/.github/blob/main/docs/standards/bug-means-missing-guard.md)): the fix PR first adds a guard that fails on `main`, then fixes the bug; the bug issue says why the guards missed it.
