# Privacy impact assessment (EFVP) — Verikora

Act respecting the protection of personal information in the private sector, CQLR c. P-39.1, art. 3.3 (a new electronic
service that involves personal information). Issue: krizaka/verikora#365.

**Status: draft written from the code and the deployment spec.** It states facts the repository shows. It makes no claim the
code does not support; where the code is silent the cell says « not stated in the code ». The review by the person in
charge of the protection of personal information is recorded at the end and is not done yet. The places outside Québec and
their art. 17 assessment are in [transfers.md](transfers.md); the register that the build checks is
[transfers.json](transfers.json).

Sources: `apps/web/lib/migrations.ts` (the tables), `apps/web/lib/env.ts` (the configuration), `deploy/digitalocean/dev.app.yaml`
(the deployment), ADR-0004 (payments), ADR-0006 (personal information in documents), ADR-0007 (storage and retention).

## 1. The data map

| Data | Whose | Why | Where it lives | Who can see it | How long | How it is destroyed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Account: e-mail, password hash, role, status, language, creation and last-seen dates (`accounts`) | The person who signs up | Sign in, send the verification link | `database` | The person; an administrator, from the console (allow-list of addresses, `AUTH_ALLOWED_IPS`) | While the account exists | Account deletion; export available |
| Session: token hash, address (`ip`), browser (`user_agent`) (`sessions`) | The person | Keep the person signed in | `database` | The person; an administrator | 14 days (`SESSION_TTL_DAYS`) | Expiry; sign-out |
| E-mail verification and change links: token hash, dates (`email_verifications`, `email_changes`) | The person | Confirm an address | `database` | Administrator | Until used or expired | Expiry |
| Consents: key, granted, revoked (`consents`) | The person | Record the acceptance of the terms and the privacy notice | `database` | The person; an administrator | While the account exists | With the account |
| Documents a person asks to check: title, file name, type, size, SHA-256, pages, the file, the extracted text (`documents`) | The person; the people named in the document (leases, pay stubs, invoices) | Run the check the person asked for | `database` (default), or the configured store: `documents-bunny` in development (fictional data only), `documents-s3` in production or a workspace's own bucket | The owner; the people the owner shared a report with (grants); an administrator | Not kept by default: the file and its text are purged once the check ran (`purgeDocument`); a never-checked document, after `APP_PURGE_AFTER_HOURS` (24 by default); kept only when the person chooses « conserver » | Purge, or immediate audited deletion by the owner |
| Analyses: studio, run id, inputs, report, search text (`analyses`) | The owner, and the people named in the document | The findings and the signed report | `database`; the text of the document goes to `engine` for the run | The owner and the grantees | While the document record exists | With the document record |
| Report grants and access requests: grantee e-mail, requester e-mail (`report_grants`, `report_access_requests`) | The person invited or asking | Share a report; ADR-0002 | `database` | The owner; the grantee; an administrator | Until expiry or revocation | Revocation; with the report |
| Organisation: libraries, collections, folders, tags, names (`libraries`, `collections`, `folders`, `tags`) | The owner | Organise documents (ADR-0007) | `database` | The owner | While the account exists | Deletion asks what happens to the files |
| Batches: name, file names, references, the request (`batches`, `batch_items`) | The owner | Check many documents at once | `database` | The owner | While the account exists | With the account |
| Applicant files (« screenings »): tenant name, tenant e-mail, scope, status, result, contest comment (`screenings`) | A tenant, requested by a landlord | A tenant-screening request the tenant answers | `database` | The landlord who asked; the tenant | Request valid 14 days (`REQUEST_VALID_DAYS`); result kept 30 days (`RETENTION_DAYS`) after sharing, then purged (`purged_at`) | Expiry and purge |
| Applicant consents: purpose, notice version, means, dates (`application_consents`) | The tenant | Prove what the tenant agreed to, and when | `database` | The landlord; the tenant | With the request record | With the request record |
| API keys: name, public id, secret hash, scopes, dates (`api_keys`) | The owner | Programmatic access | `database` | The owner | Until revoked or expired | Revocation; the secret is stored as a hash only |
| Storage settings: a workspace's own bucket endpoint, region, bucket, access key id, **sealed** secret (`storage_settings`) | The owner | Bring your own cloud | `database` | The owner; the secret is never shown again | While configured | Removal |
| Payments: payment events (`payment_events`), plan, customer id, subscription status (`accounts`) | The customer | Billing; ADR-0004 | `database`; the e-mail and the plan go to `payments` | The customer; an administrator | While the account exists | With the account; the processor keeps its own invoices |
| Pre-flight events: outcome, reason, account (`preflight_events`) | The owner | Count the checks avoided | `database` | An administrator | Not stated in the code | Not stated in the code |
| Audit log: actor, action, target, detail, address (`audit_log`, `settings_audit`) | The people acting | Accountability | `database` | Administrators | Not stated in the code | Not stated in the code |

What the code does about personal information inside documents (ADR-0006): the scanner (`lib/pii/`) finds social insurance
numbers, e-mails, phones, addresses, postal codes, dates of birth and bank accounts, and returns **positions and counts, never
values**; values are not written to the audit line; the redacted export blanks them. Nothing new is stored by the scan.

Protection measures the code shows: the database connection verifies the cluster's certificate (`DATABASE_CA_CERT`, never
`rejectUnauthorized: false`); kept documents are encrypted before they leave (`MEDIA_DOCUMENTS_ENCRYPTION_KEY`, AES-256-GCM
as declared in `lib/env.ts`) and handed out through signed, expiring links; a workspace's own bucket credentials are sealed
(`APP_SETTINGS_ENCRYPTION_KEY`); passwords, session tokens and API secrets are stored as hashes; the administration is limited
to an allow-list of addresses; the audit log records who acted; a production server refuses to start without its secrets
(`productionProblems`) and refuses the development store (Bunny) in production.

## 2. The risks and the measures

| Risk | Measure in the code | Gap, as the code shows it |
| :--- | :--- | :--- |
| A document kept longer than the person wanted | Not kept by default; purge after the check; purge window for unchecked documents | None stated |
| A report read by someone who should not | Members only, by grant (ADR-0002); every verification and refusal audited | None stated |
| A document stored outside Canada | Bunny is refused in production; production store is a Canadian region (`tor1`); residency is read from the region and shown to the person | In development, kept documents are at `documents-bunny` (New York) — fictional data only |
| Personal information reaching an AI model's logs | Analyses run on `engine` only, through its key; no model is called from the app | What the engine retains is described in its own repository, not here |
| A provider receiving more than its mandate | One purpose per provider (see transfers.md) | The written contracts are not in this repository (open item in transfers.md) |
| Retention of the audit log and pre-flight events | — | No retention period is stated in the code |

## 3. Review

| Item | Value |
| :--- | :--- |
| Person in charge of the protection of personal information | to be recorded |
| Reviewed on | to be recorded |
| Outcome | to be recorded |

Open question for the lawyer (from the issue): whether a provider's standard data processing addendum is enough for art. 17
and art. 18.3, and whether a CDN edge outside Canada counts as a communication outside Québec.
