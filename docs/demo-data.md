# Demo data (persona Éric)

Everything here is fictitious: invented people, addresses (postal codes with a letter Canada Post never issues), SIN-like numbers starting with 0, made-up companies. Every PDF page carries « SPÉCIMEN — document fictif ».

- `pnpm run demo:documents -- --out <dir> [--seed <n>]` writes the PDFs and `findings.json` (the expected findings of each variant). Deterministic: same seed, same bytes. The PDFs are never committed.
- `pnpm run demo:seed -- --persona eric [--locale fr|en] [--reset]` (needs `DATABASE_URL`; optional `APP_DEMO_ACCOUNT_EMAIL`, `APP_DEMO_ACCOUNT_PASSWORD`) creates the account with its display name (« Éric Tremblay », shown by the header instead of the address; a name the person chose is kept) and the collections « Immeuble Rosemont » (6), « Candidats — 4½ Villeray » (6) and « Factures 2026 » (4) with seeded checks (run id `seeded-…`, inputs `seeded: true`; no engine call, no paid run). A re-run changes nothing; `--reset` starts over. It refuses when `APP_ENVIRONMENT` is not `dev`.
- Admin settings are already filled by the registry's defaults (`lib/settings/registry.ts`).
- A public copy on Bunny (`site/products/verikora/demo-documents/`) is uploaded by the CTO with krizaka-com's `cdn-assets upload`.
