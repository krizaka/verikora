# ADR-0012 — A document's bytes leave PostgreSQL: one store for every file, a purge that deletes the object

Status: accepted (2026-10-28, delegated CTO call; the paid or irreversible steps wait for Oussama, see « Needs Oussama »).
Extends ADR-0007 (the `DocumentStore` port, decision 2). Issues: krizaka/verikora#17 (web: bytes out of the database, purge),
#153 (port and adapters), #154 (Mac), #155 (phone). Libraries: `@krizaka/storage` (krizaka-ts; org ADR krizaka/.github#248).

## Context — what runs on main today
- The port is built. `DocumentStore` is `@verikora/core`'s (`packages/core/src/document-store.ts`, contract kit shared by
  every app); the web wraps a `@krizaka/storage` `ObjectStore` (`apps/web/lib/storage/adapter.ts`), chosen in one place
  (`lib/storage/config.ts`: `none` by default, `bunny` refused when `APP_ENVIRONMENT=prod`, `s3` for DigitalOcean Spaces, a
  customer's bucket or SeaweedFS in CI). Bring your own S3 (sealed secret, connection test) is in `lib/storage/settings.ts`.
  The Mac (`apps/desktop/src/lib/mac-store.ts` + `src-tauri/src/store.rs`) and the phone (`apps/mobile/src/data/device-store.ts`)
  have their adapters.
- **But the bytes still sit in `documents.content` (BYTEA) in three cases**: every document that is **not kept** (the default:
  `storage = 'none'`, held until its check runs or `limits.purgeAfterHours` passes, 24 h by default, 720 h at most), every
  document kept on a deployment with no external store (`storage = 'database'`), and every document saved before the store
  existed. Only a document kept on `bunny` or `s3` has its bytes moved out (`moveToStore`, then `content = ''`).
- The purge (`lib/retention.ts`, ADR-0001 « what runs ») empties the column and writes `document.purged` to the audit. A
  database purge does not reach the provider's backups: a « purged » file stays in the managed PostgreSQL's backups for their
  rotation (`docs/privacy/retention.md`, « Backups — not covered »). This is the real cost of the column, more than its size.

## Options
1. **Keep the column for transient bytes, store only kept documents** (today). Simple, one code path less; but the default
   path (nothing kept) is exactly the one whose bytes then live on in database backups, and the table grows with every upload.
2. **Every document's bytes in the store, the database keeps only metadata and text** (chosen). One place for a file, so one
   delete purges it; the database and its backups never hold a document again.
3. **Crypto-shredding in the column** (encrypt each document with its own key, drop the key at purge). Rejected: the key would
   live in the same database and therefore in the same backups; it proves nothing without a key service we do not run.
4. **A provider lifecycle rule as the purge** (expire a `transient/` prefix). Rejected as the mechanism: Bunny and a customer's
   bucket have no such rule, and the purge must be ours, audited, to the hour. It may be added on Spaces as a safety net.

## Decision
1. **No document bytes in PostgreSQL.** Every new document is written to the deployment's store at upload, kept or not. The
   row carries `object_key` (nullable text): set means « the bytes are in the store under this key », null means « no bytes ».
   `storage` keeps its meaning (where a *kept* document lives, what the info panel says); `none` now means « not kept, the
   bytes are in the store until the purge ». `storage = 'database'` is no longer written; existing rows are backfilled.
2. **Every deployment has a store.** dev: Bunny (fictional data only, already enforced); CI and local: SeaweedFS (S3, the
   existing `scripts/ci-s3.sh`) or `@krizaka/storage`'s folder store for a laptop; production: Spaces `tor1`. A production
   start without an `s3` store refuses uploads (fails closed, 503), as Bunny is already refused there. The *keeping* choice
   (admin mode `none`, per-user « keep my history ») is unchanged: it decides how long the bytes stay, not whether a store exists.
3. **One key per document, never moved**: `objectKey(owner, document, mime)` as today (`<owner>/<document>/original.<ext>`
   under `MEDIA_DOCUMENTS_PREFIX`). Choosing to keep a document later changes its row, not its key.
4. **Order of writes, so no object is ever unowned**: insert the row with its `object_key` (extraction pending) → `put` → if
   the put fails, delete the row (502 `STORAGE_UNAVAILABLE`, as `moveToStore` does now). Delete and purge: `store.delete`
   first, then the row; if the store does not answer, the row keeps its key and its deadline, and the sweep retries.
5. **The purge deletes the object** (`purgeDocument`, `purgeIfDone`, `purgeExpired` keep their names, rules and audit
   rows): object deleted, then `object_key = NULL, text = ''`. Retention is the existing one, untouched: purge when the check
   ends, `limits.purgeAfterHours` for a document never checked, `document_types.retention_policy` for kept ones, immediate
   delete and export (`lib/account/export.ts`) through the stores.
6. **A daily reconciliation**: list the store's prefix, delete every object no row references (and retry rows past their
   deadline whose object still exists); counts go to the audit. The generic part (« list a prefix, delete what a predicate does
   not know ») goes into `@krizaka/storage` first (`sweepOrphans(store, prefix, isReferenced)`), not into a local copy.
7. **Encryption at rest, in two layers**: the provider's (Spaces server-side encryption; the managed PostgreSQL's disk
   encryption for metadata and text), and ours: `encryptedStore` (AES-256-GCM, `@krizaka/storage`) with
   `MEDIA_DOCUMENTS_ENCRYPTION_KEY` on Krizaka's store — **required** when `APP_ENVIRONMENT=prod` (the start refuses
   otherwise), so the provider only ever holds ciphertext and never hands out a readable link. A customer's own bucket is
   theirs: we do not wrap it unless the workspace asks, and the panel says « chiffré » only when the configuration proves it
   (`residency-claims.test.ts`, as today). Signed links stay capped at 900 s (`MAX_SIGNED_URL_SECONDS`); an encrypted store
   has no link, the app serves the bytes.
8. **Versioning off on Krizaka's buckets**, so a delete is final; a customer's versioning is theirs and the panel says so.
9. **Data residency — Canada.** Production: Spaces `tor1` (Toronto) for the bytes, the managed PostgreSQL in `tor1` for the
   rest (cluster `krizaka-dev-pg`, `tor1`). Bunny has no Canadian region: dev only, refused in production (as today). A
   customer's bucket: residency read from the region table (`COUNTRY_OF_REGION`), shown to the admin, never assumed.
   Transient bytes are personal data too: they live in the same store, so under the same residency.
10. **The Mac and the phone** (#154, #155) keep their files on the device (`storage = 'device'`, no `object_key`, nothing in
   the server's store). For a check, only the bytes the check needs are sent; on the server they are a not-kept document
   like any other (store, check, purge). Library and tags sync as metadata only, through an API that refuses bytes.

## Migration — from BYTEA to the store
1. **Schema** (additive, reversible): `documents.object_key text NULL`; a partial index on rows where it is set.
2. **Write path**: new documents go to the store (decision 1); `content` is written `''`.
3. **Dual read** (`readBytes`): `object_key` set → the store; else non-empty `content` → the column (legacy); else 409
   `NOT_KEPT`. The purge clears both until the backfill ends.
4. **Backfill** (`scripts/documents-backfill.mjs`, idempotent, batched, resumable, `--dry-run`): for each row with bytes in the
   column: put under its key, read it back and check its SHA-256 against `documents.sha256`, then
   `UPDATE … SET object_key = $key, content = '' WHERE id = $id AND object_key IS NULL`. Not-kept rows past their deadline are
   purged instead of copied. It prints counts (copied, purged, failed) and writes one audit row per run.
5. **Guard**: a check (`scripts/check-document-bytes.mjs`, in CI on the seeded database and runnable on a deployment) fails when
   any row has `octet_length(content) > 0`. Once green on a deployment, the dual read's column branch is removed.
6. **Drop** `documents.content` and reclaim the space (`VACUUM FULL documents`) — on dev (fictional data) when the guard is
   green; on any deployment that holds real data, only after a fresh backup and Oussama's go.
7. **Backups**: once the column is gone, the database's backups hold no document bytes; the extracted text remains until the
   purge, so `docs/privacy/retention.md` « Backups — not covered » is narrowed to the text, not removed. A nightly encrypted
   `pg_dump` to a second, independent place is a separate decision (its destination is a paid provider), filed on its own.

## Consequences
- One delete purges a file; the purge is verifiable on the store as well as in the audit.
- The database shrinks to metadata and text; the store becomes a hard dependency of uploads (it is already one for kept
  documents). An outage of the store refuses uploads with 502 instead of silently writing to the database.
- Losing `MEDIA_DOCUMENTS_ENCRYPTION_KEY` loses every encrypted document: the key lives in the vault with an offline copy;
  rotation (re-encrypt under a `v2.` key) is a later task, the envelope already carries the version.
- Tests stay free of paid services: the contract kit on memory, folder and SeaweedFS; the backfill and the purge against a
  real PostgreSQL plus SeaweedFS in CI.

## Slices (the build)
- **#17 — web: bytes out of the database, the purge deletes the object.** Decisions 1–8, migration steps 1–6 on dev, the
  sweep (`sweepOrphans` in `@krizaka/storage` first), the prod start guards (store and key required). The off-site `pg_dump`
  moves to its own issue (needs Oussama for the destination).
- **#153 — port and adapters.** Delivered on main (port, `none`, `bunny`, `s3`, bring your own S3, settings, connection test,
  residency claims); left: the Spaces `tor1` bucket (needs Oussama) and its live contract run, then close.
- **#154 — Mac.** Adapter on main; left: metadata-only sync of the library, check upload as a not-kept document, `.dmg`,
  signing and notarisation (Developer ID), demo clip, « bientôt » download.
- **#155 — phone.** Adapter on main; left: metadata-only sync (shared with #154), library deep links and tags, demo clip,
  « bientôt » download.

## Needs Oussama (paid or irreversible)
- **Create the Spaces `tor1` bucket** (about 5 USD/month) and its access keys, versioning off, server-side encryption on. No
  bucket was found; `doctl` lists buckets only with Spaces keys, which are not configured here.
- **The off-site backup destination** for the nightly encrypted `pg_dump` (a second provider is a new, paid account).
- **Custody of `MEDIA_DOCUMENTS_ENCRYPTION_KEY`** for production (an offline copy outside the cloud account).
- **Dropping `documents.content`** on any deployment that holds real data (after the guard is green and a fresh backup).

## Amendment (2026-10-28, verikora#523, krizaka-ts ADR-005)
- **The store is chosen by the admin, in the database.** `storageFrom`'s selection by environment is replaced by the provider registry of `@krizaka/storage`: `storage.provider` holds the admin's providers (credentials sealed under `MEDIA_VAULT_KEY`), `storage.default_provider` the default for `documents` and `avatars`. The `MEDIA_DOCUMENTS_*`, `MEDIA_STORAGE_*` and `MEDIA_S3_*` variables only bootstrap: at the first start with no provider, they are imported once as an active provider (`source: env`, audited), so the development deployment keeps using the Bunny zone `yomizaka-docs-dev` and its existing objects still open (the encryption key is imported as the provider's sealed credential).
- **`documents.provider_id`** records which provider holds a document's bytes (migration 0059; rows already in a store are given the imported provider). It is what lets a later provider switch move objects and read from both stores.
- **No provider, no vault key: nothing is kept**, uploads answer 503 `STORAGE_NOT_CONFIGURED`. No bytes go into PostgreSQL and the web never writes the local disk (a `folder` provider opens only in a development runtime).
