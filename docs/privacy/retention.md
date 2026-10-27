# Retention — what is kept, for how long, and what a purge leaves

Retention is **data** (yomizaka#125, Loi 25: keep only as long as necessary). A policy is a row of `retention_policies`
(`after-check`, `after-decision`, or `days`); a document type points at one (`document_types.retention_policy`); an owner may
override a subject with a `retention_rule`; the screening result's window is the global rule of the subject
`screening-result` (policy `thirty-days`). Changing a row changes the behaviour, with no deploy.

| What | Default | Kept longer only if |
| :--- | :--- | :--- |
| A document (file and text) | purged right after its check; if never checked, after the configured window | the person chooses « keep » (the day is recorded, `documents.keep_consent_at`), or, for an applicant file, the applicant consented to `DOCUMENT_KEEP` and the type's policy is `after-decision` |
| An applicant file's documents | purged after the check; kept until the manager's decision only with consent | never past the decision |
| A screening result (summary) and what its checks kept | `thirty-days` after the applicant's consent | never; the applicant may erase it earlier |

A purge removes the file and its text and **keeps** the hash, the report and the signed certificate. Each purge writes an audit row
`document.purged` (or `screening.purged`); a sweeper runs on the server's background tick.

## Backups — not covered

A purge acts on the live database and the document store. Database backups of the provider keep a copy until their own rotation
ends, and a restore would bring a purged file back until the purge runs again. The backup window is the provider's (see Orazaka
ADR-078 « not covered »); the lawyer review states it in the privacy notice. Until then the notice says purged documents may remain
in encrypted backups for their rotation period.
