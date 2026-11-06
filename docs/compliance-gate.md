# Compliance gate — before any live screening resale

No live call to a credit or court-records provider, and no resale of a check, until every blocker below is marked **done with the
date and the reference of its evidence** (`compliance_gate` table; `GET/PUT /api/admin/compliance-gate`, admin only). Live mode is
Oussama's switch, the setting `features.screeningLive` (off by default); the server refuses to start with it on while a blocker is open, and every
live adapter refuses at call time (NOT_CONFIGURED, the provider is never reached). Build and proof stay in test and demo.

| Blocker | Needed for live |
| :--- | :---: |
| `reseller-agreements`: signed reseller/partner agreement with each provider (permissible purpose, resale) | yes |
| `lawyer-credit-for-rental`: lawyer sign-off on credit checks for rental | yes |
| `efvp`: privacy impact assessment (ÉFVP, Loi 25) completed and filed | yes |
| `consent-text`: per-check consent text reviewed (specific, written; logged with version, price and payer) | yes |
| `provider-residency`: provider data residency verified as Canada | yes |
| `adverse-action-wording`: adverse-action wording reviewed by a lawyer | yes |
| `criminal-records-lawful`: a lawyer confirms criminal-record checks are lawful for rental | only for that check type, which stays off and cannot be requested until this row is done |

The wording in the product (consent, adverse action, payer rules) is a placeholder until the lawyer review (krizaka/.github#250).

## Lawyer review checklist (not live blockers: nothing here calls a provider)

- **Rent-to-income share (TS-A-001, #557/#558).** Shown to the landlord as information, never as pass/fail, score, threshold or refusal
  reason; the copy says it must not be the sole criterion (`affordability.note`, EN/FR, guarded by `affordability.test.ts`).
  Basis: Québec Charter s. 10 and 12 (social condition); CDPDJ lists a modest income and welfare benefits as social condition
  (cdpdj.qc.ca « Louer sans discrimination »), recommends proof of income over a credit check, and says a person without rental
  history cannot be refused for that alone (cdpdj.qc.ca FAQ « Logement - Propriétaires ou mandataires »). **Not verified word for
  word:** a CDPDJ text about a rent-to-income ratio specifically. The lawyer confirms the position and the wording before any UI wiring.

Tenant shield, lawyer review (verikora#562): the deadline to ask the TAL to fix the rent (`lib/rules/section-g-deadline.ts`) rests on the TAL page « Avis au nouveau locataire » (10 days from the conclusion of the lease; two months from the start when no notice; two months from knowing of a false statement). The text of art. 1950 C.c.Q. could not be read (legisquebec answers 403 to the session): confirm the deadlines and how days and months are counted.

Tenant shield, lawyer review (verikora#566): the facts to bring to the TAL (`lib/rules/section-g-request.ts`) is a summary of the lease figures, not a filing and not a form. The TAL page « Avis au nouveau locataire » names no form or fee for the rent-fixing request (the page lists a form « Demande » without linking it): confirm which form applies and whether Verikora may name it, and the wording « no verdict ».
