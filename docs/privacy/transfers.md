# Transfers outside Québec — register and art. 17 assessment

Act respecting the protection of personal information in the private sector, CQLR c. P-39.1, art. 17 (communication outside
Québec) and art. 18.3 (service providers). Issue: krizaka/yomizaka#365. The data map is in [efvp.md](efvp.md).

**The register is [transfers.json](transfers.json).** `scripts/privacy-register.test.mjs` fails the build when
`deploy/digitalocean/dev.app.yaml` or `apps/web/lib/env.ts` adds a variable of a data context (`DATABASE_`, `MEDIA_`,
`MAIL_`, `PAYMENTS_`, `AI_`) or a host that the register does not list. Adding a store or a region therefore starts here.

Every place below is outside Québec as the register states (the application itself runs on DigitalOcean App Platform, region
`tor`). « Not stated » means the code and the spec do not say; it is not a claim in either direction.

| Id | What goes there | Provider | Where | Outside Canada |
| :--- | :--- | :--- | :--- | :--- |
| `database` | Accounts, document records, analyses, audit, applicant files | DigitalOcean managed PostgreSQL (cluster `krizaka-dev-pg`) | Toronto (`tor`) | No |
| `documents-bunny` | Kept documents, development only, fictional data | Bunny Storage, private zone, token-authenticated pull zone | New York; the pull zone is a CDN | Yes |
| `documents-s3` | Kept documents in production, or a workspace's own bucket | DigitalOcean Spaces, or the customer's S3 endpoint | Toronto (`tor1`); the customer's choice for its own bucket | No for `tor1` |
| `documents-user-cloud` | The documents a person chooses to keep, in a folder of this app in their own cloud; the sealed refresh token stays here | Dropbox, Google Drive or Microsoft OneDrive, the one the person connected | The provider's, under the person's own account | Not stated |
| `mail` | The recipient's address and the message of verification and notice e-mails | Mailgun | Not stated (default endpoint `api.mailgun.net`) | Not stated |
| `payments` | The account e-mail, the plan, payment events | Stripe | Not stated | Not stated |
| `engine` | The text of a document sent for a check; the run id comes back | Orazaka (Krizaka's engine) | `dev.orazaka.com/edge`; hosting described in Orazaka's repository | Not stated here |

## Art. 17 assessment, one line per place

The factors of the article: sensitivity, purposes, protection measures (contractual included), legal framework of the place.

- `database` — Toronto is in Canada, outside Québec. Sensitivity: high (accounts, document records, reports). Purpose: run the
  service. Measures: verified TLS to the cluster, hashes for secrets, allow-listed administration. Legal framework: Canadian.
- `documents-bunny` — Development only, **fictional data only**; production refuses it (`productionProblems`). It is outside
  Canada. No real person's document is sent there by design; the assessment for real data is that it must not be used.
- `documents-s3` — Production store: a Canadian region (`tor1`), encrypted before sending. A customer's own bucket is the
  customer's decision; its residency is read from the region and shown.
- `documents-user-cloud` — Purpose: keep the person's documents where they already have storage. Only after the person connects it (OAuth with PKCE, the app's folder only), and the administrator opened it; disconnecting revokes the grant and forgets the token, the files stay in their cloud. Residency is the provider's and the person's to judge.
- `mail` — Purpose: deliver a link or a notice. Content: the address and the message text. The server location is not stated
  in the code; to be confirmed from the provider's terms before opening.
- `payments` — Purpose: payment and invoices (ADR-0004). The server location is not stated in the code; to be confirmed.
- `engine` — Purpose: the check the person asked for. The engine's own retention and hosting are not stated in this repository.

## The contract that covers each place (art. 17 written agreement, art. 18.3)

| Id | Contract | Status |
| :--- | :--- | :--- |
| `database` | DigitalOcean terms and data processing addendum | to be linked and reviewed |
| `documents-bunny` | Bunny terms | not needed for production (refused there) |
| `documents-s3` | DigitalOcean terms and data processing addendum | to be linked and reviewed |
| `documents-user-cloud` | The provider's own terms, accepted by the person with their own account | the person's own relationship with it |
| `mail` | Mailgun data processing addendum | to be linked and reviewed |
| `payments` | Stripe data processing agreement | to be linked and reviewed |
| `engine` | Between Krizaka products: the intra-group agreement | to be written |

Questions for the lawyer: is a provider's standard addendum enough for art. 17 and art. 18.3, and does a CDN edge outside
Canada count as a communication outside Québec?
