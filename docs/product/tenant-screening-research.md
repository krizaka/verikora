# Checking a tenant's application (« dossier ») — research, law, and what Verikora builds

*Researched 2026-10-17. Every claim carries its source; a claim that a source did not confirm is marked **unverified**. This is
product research, not legal advice: the Québec position below needs a lawyer's review before the feature is offered outside dev.*

## 1. The plain answer

- **A criminal-record check is not justifiable for most tenancies in Québec, and Verikora will not offer one.** The landlord's need
  is to know the person is who they say and can pay the rent and respect the lease; a criminal record answers neither, collecting
  it is a personal-information collection the CAI judges against *necessity*, and a refusal that is really about a protected
  ground is unlawful under the Charter (art. 10 and 12 apply to housing). Whether a criminal record is itself covered in housing
  is **unverified** — no source found states it. A CAI complaint of 2018 concerned exactly a background check run without the form saying so
  ([CAI DSV 100475](https://www.cai.gouv.qc.ca/uploads/pdfs/CAI_DSV_100475.pdf)). Sources did not state a rule on criminal records
  specifically (Silaws' 2026 guide lists them as neither clearly allowed nor prohibited): **unverified** — hence « not offered ».
- **What is lawful, and what Verikora offers:** identity confirmed by looking at an ID without keeping a copy; the previous
  landlord's contact; a **credit/payment-history check only with the tenant's consent**; proof of income **examined** (is the PDF
  edited?) rather than collected and kept. [Protégez-vous](https://www.protegez-vous.ca/nouvelles/affaires-et-societe/futurs-locataires-ce-qu-un-proprietaire-peut-vous-demander),
  citing the TAL: the information collected is limited to what verifies identity and shows the applicant is a reliable tenant; a
  landlord may check payment history through a credit bureau **with the tenant's consent** (name, current and previous addresses,
  date of birth suffice) and cannot *require* one; a SIN, passport, driver's licence, health-insurance number, bank details,
  employer name or salary cannot be required ([Éducaloi](https://educaloi.qc.ca/actualites-juridiques/futurs-locataires-cinq-choses-a-savoir)
  adds that courts generally consider the SIN not necessary). The CAI has repeatedly found SIN, financial-institution data, employer
  details and salary not necessary to assess an applicant ([decision 2017–2018](https://decisions.cai.gouv.qc.ca/cai/ss/fr/484179/1/document.do)),
  and was asked about a rejection motivated by a refused credit check (2013, 2017): a landlord may ask for financial references, but
  refusing unnecessary information must not be a reason to reject.
- **Contested in practice:** the SIN for a credit check (the CORPIQ form asks for it, its president defends it — [Noovo](https://www.noovo.info/video/quels-renseignements-un-proprietaire-a-t-il-le-droit-de-me-demander.html)).
  Verikora never collects a SIN.

## 2. The Québec law that frames it

| Rule | What it means for a screening | Source |
|:---|:---|:---|
| **Act respecting the protection of personal information in the private sector (Law 25 amendments)** — consent must be *manifest, free, informed, specific, limited in time*; collect only what is **necessary** for the declared purpose; inform the person at collection (purpose, who sees it, how long, their rights); keep only as long as necessary; a privacy-impact assessment for a project involving personal information; breach notification | Consent flow initiated or approved by the tenant; minimal fields; retention limit; no raw provider report stored; incident log | [CAI](https://www.cai.gouv.qc.ca) — **text to be confirmed by a lawyer** (the searches returned CAI decisions from before Law 25, not the Law 25 text) |
| **Necessity test** (CAI decisions) — the organisation must show each item collected is necessary to assess the application | SIN, bank data, employer, salary: not collected | [CAI decisions](https://decisions.cai.gouv.qc.ca/cai/ss/fr/484179/1/document.do) |
| **Charter of human rights and freedoms (Québec)** — no discrimination in the lease of a dwelling on the grounds of art. 10 (race, colour, sex, pregnancy, sexual orientation, civil status, age, religion, political convictions, language, ethnic or national origin, social condition, disability…), and art. 12; **art. 1899 C.c.Q.** forbids refusing a tenant because of children | Results shown to the landlord carry **no** personal characteristics; the landlord's undertaking says so; the tenant can contest | [Charter](https://www.legisquebec.gouv.qc.ca/en/document/cs/C-12), C.c.Q. art. 1899 (the Québec ruleset already tests the clause) |
| **TAL guidance** — what a landlord may ask; the lease form's mandatory content | The product shows the lawful list to the landlord before a request | [Protégez-vous citing TAL](https://www.protegez-vous.ca/nouvelles/affaires-et-societe/futurs-locataires-ce-qu-un-proprietaire-peut-vous-demander) |
| Federal PIPEDA for credit bureaus' own handling | Providers are processors/controllers on their side | secondary: [TenantPay](https://www.tenantpay.com/blog/tenant-screening-canada-legal-checks) |

## 3. Providers (what the sources say; pricing and API access to confirm with each)

| Provider | What it offers | Price found | API / onboarding | Notes |
|:---|:---|:---|:---|:---|
| **SingleKey** | Tenant screening report; credit from Equifax and/or TransUnion; Openroom court-order records; serves all of Canada incl. Québec | **$29.99 CAD** one bureau, **$44.99 CAD** dual ([SingleKey](https://www.singlekey.com/en-ca/tenant-report/)) — vendor page | Not found: **unverified** (ask for a partner API) | Says the application must disclose the check and the applicant's permission is required ([guide](https://www.singlekey.com/run-credit-check-tenant/)); says rental credit checks are soft inquiries since Nov 2024 (vendor claim — verify with the bureaus) |
| **Certn** | Criminal, credit, reference, ID checks; Canadian property-management product with an API / leasing-software integration | US pricing seen: credit **$9.50**, criminal **$17.99** (third-party review site — **not Canadian pricing**) | API exists ([Certn](https://certn.co/?p=7438)); docs not found | We would use **credit and ID only**, never the criminal check |
| **Equifax Canada** | The bureau; rental debt data supplied by Openroom ([Openroom](https://openroom.ca/learn/post/openroom-equifax-rental-debt-partnership/)) | not published | Direct bureau access needs a **business account, a signed membership agreement and a declared permissible purpose** — standard bureau onboarding, **unverified for rental use** | Direct access is a contract with the bureau |
| **TransUnion Canada** | The bureau; a rental-screening product exists in the US (SmartMove) | not found | Canadian landlord onboarding **not found** | Same as Equifax |
| **Naborly** | Screening product relying mainly on Equifax ([SingleKey/Naborly FAQ](https://www.singlekey.com/en/singlekey-naborly-faq/)) | not found | not found | Merged with SingleKey (FAQ) |
| **Openroom** | Crowdsourced court-order (rental debt) data; **does not run screenings** | — | partner data via SingleKey | A data source, not a provider to call |
| **Triton** | not found in the sources searched | — | — | **unverified** — asked for in the brief |

## 4. The flow Verikora builds (provider-agnostic, now)

1. **The landlord** (who has accepted an undertaking — the lawful purpose, no discrimination, the list of what may be asked)
   creates a request: the applicant's name and e-mail, the scope (payment history only today). Nothing is collected from the
   applicant at this point.
2. **The tenant** receives a link and sees: who asks, **what is checked, why, who will see the result, for how long it is kept,
   how to contest**. They **consent or decline**. A refusal is recorded and says nothing about them.
3. On consent the **provider** is called (a fake, labelled provider today); the **tenant sees the result first**.
4. The tenant **shares it with the landlord, or contests it** (a comment). A contested result is *not* shown; the landlord sees
   only « contesté ».
5. **Minimal data and retention**: only a short summary is stored (a band and a few items), never the provider's raw report; the
   result is **deleted after 30 days** (or when the request expires), and everything is audit-logged (who requested, who consented,
   who saw what, when).
6. No criminal-record scope exists in the code. Adding one would need a lawyer's written opinion and a new flow version.

## 5. What needs Oussama (contracts) — see the `oussama-action` issue

Pick a provider (SingleKey's partner API is the shortest path to Equifax + TransUnion for Québec), confirm Québec use and the
Law 25 data-processing terms, get API credentials and a price per check, sign the agreement, and have a Québec lawyer review the
consent text and the retention period. Until then the fake provider runs in dev only.
