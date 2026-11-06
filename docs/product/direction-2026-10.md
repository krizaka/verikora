# Verikora — product direction (October 2026)

**Verikora is « lisez avant de signer »** for anyone who holds a lease, a contract or an invoice: it reads the document against
the rules that apply, shows the exact line behind every finding with its source, keeps the trace (an Sovkora run id) and
gives a signed report to the people the owner chooses. It is not limited to housing; housing is where the first rules exist.

This document is honest about what runs today and what does not. **A check that does not run is never claimed** on the site
or in the app: an audience whose rules are not built is marked « bientôt » (soon).

## Audiences, jobs to be done, and what exists

| Audience (FR / EN) | Top jobs | What Verikora checks | Rules today | To build |
|:---|:---|:---|:---|:---|
| **Locataire / Tenant** | Know what in my lease is unlawful before I sign; what to ask the landlord | Québec residential lease (C.c.Q.): forbidden deposit, post-dated cheques, no-children clause, waiver of the right to stay, identification, rent, lowest-rent notice, waiver of the rent-increase regime | **Built**: `qc-residential-lease` (10 rules, 1 judgment), plus `fr-` and `be-wal-` residential leases. Reviewed by a lawyer: **not yet** | Rent-increase notice periods and the mandatory form's section F (source text to verify), lawyer review |
| **Propriétaire (locateur) / Landlord** | Send a compliant lease; read the tenant's papers; keep and share a report | Same lease rules on the template; PDF examination (identity, proof of income: producer, dates, successive saves) | **Built**: lease rules; `document-authenticity` Studio (signals, never a verdict); sharing by grant | Tenant-file checklist (which documents to ask for, what Québec forbids asking), co-owner/manager roles |
| **Travailleur autonome / Freelancer** | Sign a service contract safely; send and receive valid invoices | Contract: payment terms and late-payment interest, IP assignment, non-compete and exclusivity, termination, liability. Invoice: GST/QST registration numbers and the mentions required in Québec | **Invoice built** (`qc-invoice`, 8 rules, pack 1.3.0; real dev run 51df2807-fca7-47a2-bdfd-d1a68403dfdc, 2026-10-19). Contracts: nothing yet | A `qc-service-contract` ruleset; for the invoice, the QST-specific requirement (Revenu Québec's page could not be read at the source) and an accountant's review |
| **Entreprise / Small business** | Supplier contracts; invoices received (is the supplier registered, are the mentions there, duplicate or edited invoice) | Supplier contract clauses (renewal, penalties, exclusivity); invoice mentions and tax numbers; PDF examination for edited invoices | **Invoice built** (same `qc-invoice`) + authenticity Studio | `qc-supplier-contract`, duplicate detection (hash already exists) |
| **Salarié / Employee** | Read an employment contract before signing | Non-compete, probation, notice, overtime, vacation — against the Act respecting labour standards | **Nothing yet** | `qc-employment-contract` ruleset; needs a lawyer's reading first |
| **Autre / Other** | Any document | PDF examination, search, the library; no rules claimed | Authenticity Studio, search | A generic contract-reading Studio (judgment rules with sources) once the rulesets above prove the method |

Out of scope on purpose: legal advice (the pack's `scopeGuard` refuses it), any verdict on authenticity (signals with three
levels), and any rule not backed by a cited source.

## How a ruleset gets built (the method that is already proven)

1. Write the requirement from the law and cite the article; **never from memory** — if the source text cannot be read, the
   rule waits (the rent-increase notice periods wait for this reason).
2. Every deterministic rule ships a PASS/FAIL fixture pair written from the requirement, plus one fixture per wording
   (ADR-072). A real run on a sample document is the acceptance test (it found the deposit gap on 2026-10-17).
3. The ruleset says `TO_REVIEW_BY_LAWYER` until a lawyer has read it; the report says so.
4. Rules are **data of the Sovkora pack** (`sovkora-packs/document-validation/rulesets`), never code in Verikora. Verikora only
   chooses the ruleset, shows the findings and keeps the run id.

## Product consequences

- The landing asks « Pour qui ? » and offers every audience; the ones without rules say « bientôt » and promise nothing.
- Onboarding asks the same question; the answer picks the check offered first and the wording, never the rules.
- The members' **signed report** becomes a signed PDF (embedded attestation + visible signature page) in addition to the HTML
  preview — a slice planned after the ruleset work (see the slice list below).
- Verification stays members-only, by grant (ADR-0002); a specimen is never a signed file.

## Slices, in order

1. QC deposit wording + rent-increase waiver rule (done, pack 1.2.0).
2. « Pour qui ? » picker, per-audience pages, « bientôt » honesty (this PR).
3. Signed PDF report for members (attestation embedded in the PDF + a visible signature page, same key, same verification).
4. `qc-invoice` ruleset (tax-number formats first: deterministic and checkable), then `qc-service-contract`.
5. Lawyer review of the Québec corpus; then the employment contract.
