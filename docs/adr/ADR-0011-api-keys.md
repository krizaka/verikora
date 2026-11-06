# ADR-0011 — API keys, behind a port that moves into `@krizaka/api-keys`

Status: accepted (2026-10-22). **Moved**: the generic module is now the package `@krizaka/api-keys` (krizaka/krizaka-ts); Verikora keeps its rules (`lib/api-keys/rules.ts`) and the wiring (`lib/api-access.ts`). Issue: krizaka/verikora#202. Shared contract: krizaka/.github#183 (Krizaka TS), krizaka/folioviv#178.

## Context
Verikora offers access by API key, and Folioviv will too (same contract, independent data). The org's rule is to share before
a second copy appears: the logic must live in a folder that can move, unchanged, into a package.

## Decision
- **`lib/api-keys/` is generic — no import from the app**: no env, no database client, no wall clock. Its ports are
  `ApiKeyStore` (insert, get, findByPublicId, list, update) and `Clock`; its rules are data (`ApiKeyRules`: prefix, scopes,
  secret length, longest life, rotation grace, « last used » throttle). A product's own decisions — its scopes, its limits per
  plan, its rate limit, its audit trail, its HTTP answers — live in `lib/api-access.ts`, the only file that knows the app.
  When `@krizaka/api-keys` exists, this folder moves there as it is and the app keeps `api-access.ts` and its rules.
- **A key is `<prefix>_<publicId>_<secret>`** (`yzk_1a2b3c4d5e6f_…`): the public id finds the record, only the SHA-256 of the
  secret is stored (the secret has 192 bits of entropy, so a fast hash is enough), the comparison is constant-time, and the
  whole key is shown **once**, in the answer that creates or rotates it. A list shows a hint (`yzk_1a2b3c4d5e6f`), never the secret or the hash.
- **Scopes are data** (`checks:write`, `reports:read`); an unknown scope is refused at creation, a missing one at use (403).
- **A key must end**: 1 to 365 days. **Rotation** makes a new key (same name, scopes and length of life) and lets the old one
  work for a grace period (24 h) so a client switches without downtime; **revocation** is immediate.
- **Stable refusal codes**, never prose: `API_KEY_MISSING`, `_INVALID`, `_EXPIRED`, `_REVOKED`, `_SUPERSEDED` (401), `_SCOPE` (403),
  `_LIMIT` (409), `_NOT_FOUND` (404), `API_PLAN` and `FEATURE_OFF` (403). An unknown key and a wrong secret answer the same.
- **The product's switches are settings** (ADR-0009, data in the database): `features.apiKeys` (the administrator's global
  switch: off, no key works and none is created), `plans.free.apiKeys` / `plans.pro.apiKeys` (how many active keys a plan holds; free
  holds none, so the API is a Pro feature until an administrator says otherwise), `limits.apiRequestsPerMinute` (per key, 429 with
  Retry-After past it). Every creation, rotation and revocation is in the audit log, without the key.
- **Routes** (session, rate-limited, never cached): `GET/POST /api/me/api-keys`, `DELETE /api/me/api-keys/{id}`,
  `POST /api/me/api-keys/{id}/rotate`. Routes that take a key call `requireApiKey(req, scope)`.

## Consequences
- The store contract (`contract.testkit.ts`) runs on the memory adapter (unit) and the PostgreSQL adapter (integration); a package
  adapter for another database passes the same tests.
- Out of this ADR, in the next pull requests: `POST /api/v1/checks` and `GET /api/v1/checks/{id}` (+ report and signed PDF), signed
  idempotent webhooks (the payments block), the OpenAPI document and its page, the keys page in account settings (the UI lane's
  blocks), usage per key, and the batch design (`POST /api/v1/batches`: N documents, per-item status, a cost estimate before start,
  pre-flight dedupe across the batch).
