# Retention — what is kept, for how long, and what a purge leaves

Retention is **data** (verikora#125, Loi 25: keep only as long as necessary). A policy is a row of `retention_policies`
(`after-check`, `after-decision`, `after-decision-days`, or `days`); a document type points at one (`document_types.retention_policy`); an owner may
override a subject with a `retention_rule`; the screening result's window is the global rule of the subject
`screening-result` (policy `thirty-days`). Changing a row changes the behaviour, with no deploy.

| What                                                                  | Default                                                                     | Kept longer only if                                                                                                                                                                                                                                                                                                               |
| :-------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A document (file and text)                                            | purged right after its check; if never checked, after the configured window | the person chooses « keep » (the day is recorded, `documents.keep_consent_at`), or, for an applicant file, the applicant consented to `DOCUMENT_KEEP` and the type's policy is `after-decision`                                                                                                                                   |
| An applicant file's documents                                         | purged after the check; kept until the manager's decision only with consent | never past the decision                                                                                                                                                                                                                                                                                                           |
| An applicant file's documents, closed « one year after the decision » | purged at the decision                                                      | the manager chooses, when closing the file, the class `one-year-after-decision` (policy row of that id, 365 days, never fewer; the admin may raise it): the documents the admin's policy lets be kept past the check stay until the decision date + that many days, then the sweep purges them (reason `one-year-after-decision`) |
| A screening result (summary) and what its checks kept                 | `thirty-days` after the applicant's consent                                 | never; the applicant may erase it earlier                                                                                                                                                                                                                                                                                         |

A purge removes the file and its text and **keeps** the hash, the report and the signed certificate. Each purge writes an audit row
`document.purged` (or `screening.purged`); a sweeper runs on the server's background tick.

## « One year after the decision » (Law 25, s. 11)

Section 11 of Quebec's Law 25 says information used to make a decision about a person is kept at least one year after the decision.
The class `one-year-after-decision` is a policy row (`purge_on = after-decision-days`, `days` ≥ 365, seeded once: an admin's edit
survives). The manager picks it when closing a file (`POST /api/applications/<id>` `{ "action": "close", "retention": "one-year-after-decision" }`);
without a choice the file closes as before, at the decision. The class never reaches past the admin's bounds: only a document whose
policy in force (the owner's rule, the global one, the type's) keeps it past the check is extended; the others are purged at the
decision. **The default has not changed** (it waits for the lawyer, krizaka-internal#3231). Nothing in the class is purged before
decision + the class's days; the existing sweep purges it afterwards. Reports and hashes stay as for any purge.

## Backups — not covered

A purge acts on the live database and the document store. Database backups of the provider keep a copy until their own rotation
ends, and a restore would bring a purged file back until the purge runs again. The backup window is the provider's (see Sovkora
ADR-078 « not covered »); the lawyer review states it in the privacy notice. Until then the notice says purged documents may remain
in encrypted backups for their rotation period.

Our own nightly copy (`deploy/backup`, `docs/DISASTER_RECOVERY.md`) adds a second place, with a window of **30 days** (the newest
7 copies are always kept). It is encrypted before it leaves the server (age, public key; the private key is offline), stored in
Canada, and holds no document bytes (they are in the document store, ADR-0012) but the database's metadata and extracted text. A
restore from it replays the purge: after any restore, run the purge sweep before the service is opened again.
