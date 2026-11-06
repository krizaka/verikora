# ADR-0002 — Verification is members-only, by grant

- **Status**: accepted (2026-10-17, Oussama)
- **Replaces**: « anyone can verify a report, without an account » (UX decision 5, first version)

## Context

Every compliance check exports a signed HTML report: the SHA-256 of the document, the Sovkora run id, the rules, every
finding with the quoted passage. The first version let anyone check a report on `/verify` without an account. But the
documents are leases and identity documents: the report names the document (title, file name, hash) and quotes its
passages. A verification page open to everyone, plus an API that answers « this hash is a real report » to anybody, is a
confirmation oracle on a confidential document, and a door a shared link or a printed QR code could leave open.

## Decision

**Verifying a report is for a signed-in Verikora member who owns the report, or to whom its owner granted access.**

- *Who*: the owner of the checked document, and the people the owner shared the report with. Verikora has no
  organisations yet: « the owner's members with the right role » is the owner account today; when accounts group into
  organisations the rule `accessTo` (`lib/report-access.ts`) gains the role check, nowhere else.
- *Grant*: from a report, the owner shares it with an e-mail address, optionally until a date. A member has access at
  once. An address with no account yet is an **invitation** (a pending grant): sign-up is closed on dev, so it waits and is
  honoured the day the account exists. A grant can be **revoked**; a revoked or expired grant opens nothing.
- *The API* (`POST /api/verify`): no session → 401; a session without a grant, or a report this server does not hold →
  the same 403 `NO_ACCESS` (the answer tells a stranger nothing about what exists); a grant, or the owner → 200 with the
  full check (signature, file hash, Sovkora run id, and the original document if given). `POST /api/verify/request-access`
  (« Demander l'accès ») records a request the owner sees beside the grants; it answers the same 202 whatever exists.
- *The page* `/verify`: signed out → sign-in, returning to `/verify` (`?next=`, same-site paths only); signed in without a
  grant → « Vous n'avez pas accès à ce rapport » with « Demander l'accès ».
- *Audit*: every verification (`report.verified`: who, which report and run, by owner or grant, ok or the reason), every
  refusal (`report.verify_denied`), every grant, revocation and request (`report.access_granted|revoked|requested`).
- *No public path remains*: the unauthenticated endpoint and the `APP_PUBLIC_ACTIONS` switch are gone. A report file prints
  the route `/verify` (which asks for sign-in); no QR code or share link verifies without a session.

## Consequences

- The report file itself is still a file: whoever holds it holds its content. What the decision protects is *verification*
  as a service — the lookup of the run and its owner, the confirmation that a document was checked — not the bytes the owner
  chose to hand out. The public key stays public (it is not a secret) and is shown on the members' page.
- The landing's sample (« A real run », a document an administrator declared a non-personal sample) can still be
  downloaded; verifying it needs a grant like any report.
- There is no e-mail delivery yet: an invitation is a pending grant the owner tells the person about; the owner is
  notified of a request in the report's sharing panel and the audit log, not by mail.

## Specimens — a sample is never a signed file (added 2026-10-17, after a review by Oussama)

A first version of the landing let anyone download a report of a fictitious lease **validly signed with Verikora's key**,
with nothing in its text or its signed payload saying it was a sample: a file that could be passed off as a real attestation,
and a public door around the members-only verification above. Removed (routes deleted, so 404). The rules:

1. **No public route serves a signed artifact**, and no public page shows the fingerprint or the key id of one. Tested:
   `lib/no-public-signature.test.ts` scans every route that is not behind a session for the signing code.
2. **A sample is a visual specimen**: an unsigned, watermarked preview (« SPÉCIMEN — bail fictif, sans valeur »), no signature
   block, no fingerprint, no key material.
3. **If a downloadable sample is ever wanted**, it is signed with a **separate demo key** (never `APP_REPORT_SIGNING_KEY`)
   and its payload carries `"specimen": true`. **Verification rejects a specimen** (`SPECIMEN`) even when its signature is
   valid (`verifyReport`, tested).
4. **Sample parties are obviously fictitious**: every name in a sample carries « (fictif) ».
