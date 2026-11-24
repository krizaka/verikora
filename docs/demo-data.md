# Demo data (persona Éric)

Everything here is fictitious: invented people, addresses (postal codes with a letter Canada Post never issues), SIN-like numbers starting with 0, made-up companies. Every PDF page carries « SPÉCIMEN — document fictif ».

- `pnpm run demo:documents -- --out <dir> [--seed <n>]` writes the PDFs and `findings.json` (the expected findings of each variant). Deterministic: same seed, same bytes. The PDFs are never committed.
- `pnpm run demo:seed -- --persona eric [--locale fr|en] [--reset]` (needs `DATABASE_URL`; optional `APP_DEMO_ACCOUNT_EMAIL`, `APP_DEMO_ACCOUNT_PASSWORD`) creates the account with its display name (« Éric Tremblay », shown by the header instead of the address; a name the person chose is kept) and the collections « Immeuble Rosemont » (6), « Candidats — 4½ Villeray » (6) and « Factures 2026 » (4) with seeded checks (run id `seeded-…`, inputs `seeded: true`; no engine call, no paid run). A re-run changes nothing; `--reset` starts over. It refuses when `APP_ENVIRONMENT` is not `dev`.
- Admin settings are already filled by the registry's defaults (`lib/settings/registry.ts`).
- A public copy on Bunny (`site/products/verikora/demo-documents/`) is uploaded by the CTO with krizaka-com's `cdn-assets upload`.
- `pnpm run dev:seed` also adds the dev pilot code `PILOTDEV1`: a credit code with the purpose « Pilot », **1 free file** (a placeholder: the real number is the founder's, edited in the console), valid 30 days, falling back to paid credits after the file. It is never seeded on a production database.

## The landlord demo (a demo given to a landlord, verikora#4785)

- **Who**: the persona `demo-landlord` (« Démo propriétaire »): a member on the landlord side, **never an administrator**, outside the cast and its fingerprint. It holds one collection, « Bail de démonstration », with one sample lease (`bail-demo-proprietaire`, fictitious, one illegal clause) and its check read from the landlord's side, which cites the Civil Code of Québec (art. 1899 et 1904). It has no candidate collection, no candidate document and no applicant file.
- **Seed**: `pnpm run demo:seed -- --persona demo-landlord` (dev and local only; `APP_DEMO_ACCOUNT_EMAIL` and `APP_DEMO_ACCOUNT_PASSWORD` name the account, default e-mail `demo-landlord@demo.verikora.test`). CI seeds it in `scripts/ci-visual-start.sh`.
- **URL the founder opens**: `https://dev.verikora.com/fr/sign-in` (the dev deployment, French first), then the library `/fr/app/documents`. The credentials of the persona are the dev deployment's own (`APP_DEMO_ACCOUNT_*` of the seed run); TO VALIDATE by the CTO: the password set on dev for this account. Sign-ups stay closed.
- **The 20 minutes**: library (one lease) → its report (the finding quotes the clause and cites the Civil Code) → the signed PDF.
- **Fallback if the app is down**: the signed PDF of that report. The dry-run journey `landlord-demo` (`apps/web/e2e/journeys/landlord-demo.journey.mjs`) downloads it, checks its seal and keeps it as `demo-fallback-report-*.pdf` next to its screenshots (`test-results/journeys`, the CI artifact). A copy sealed by the dev deployment's own key is the one to take to the demo: download it from the report's menu (« Télécharger le PDF ») on the dev deployment the day before.
