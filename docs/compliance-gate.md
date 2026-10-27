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
