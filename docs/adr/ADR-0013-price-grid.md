# ADR-0013: The price grid of the B2B pilot

- Status: grid replaced 2026-10-30 by the founder-validated one below (« Superseded grid »); accepted (2026-10-29, the CTO, a decision the founder delegated: « définis les prix avec notre audit ; on essaie
  d'être concurrentiel et on ajuste »)
- Issues: verikora#388 (the public page), #360 (the volume line), #133 (per-check billing, later), krizaka/.github#269
- Superseded in part by ADR-0015: « past the included volume the account waits, no overage » is replaced by a billed overage where the plan has a rate; the rest of this grid stands.
- Builds on: ADR-0004 (payments port), ADR-009 of krizaka/.github (prices are catalogue data the administrator schedules)

## Context

Two grids were on record and neither fit. The first one (2026-10-21) had 9,99 $ per audit and Pro at 29 $ a month: Pro cost
less than three single checks, so the single price only paid for the first two documents and the plan read as a consumer app.
The catalogue's seed (from the pricing audit) had 0,65 $ per document, 59 $ a month for 100 and 279 $ a month for 750. It was
benchmarked against identity-verification APIs, which Verikora is not (it verifies documents and screens files, it never
verifies identities). Next to what a landlord pays to screen an applicant, 0,65 $ reads as a toy price, and 279 $ is a big
first ticket for a pilot.

What a landlord or a manager pays today in Québec and Canada to screen one applicant (public prices, read 2026-10-29):

| Offer                                                                   | Price (CAD, plus taxes)                      | Source                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SingleKey tenant report, one credit bureau                              | 29,99 $ a report, no subscription            | [singlekey.com](https://www.singlekey.com/en/knowledge-base/tenant-report-faqs/what-is-the-cost-of-the-tenant-report)                    |
| SingleKey, both bureaus                                                 | 44,99 $ a report                             | [singlekey.com](https://www.singlekey.com/en/knowledge-base/%25f0%259f%2592%25bc-singlekey-pricing-breakdown-know-what-youre-paying-for) |
| FrontLobby credit report                                                | 10,99 $ (Premium member) to 18,99 $ (Basic)  | [help.frontlobby.com](https://help.frontlobby.com/what-do-frontlobby-credit-reports-cost-in-canada)                                      |
| CORPIQ ProprioEnquête                                                   | members only, prices not published           | [corpiq.com](https://www.corpiq.com/en/services/62-pre-rental-screenings.html)                                                           |
| Document-fraud tools for property managers (pay stubs, bank statements) | per applicant or per document, on quote only | e.g. Snappt, Ocrolus Detect ([docs.ocrolus.com](https://docs.ocrolus.com/docs/product-sku-core))                                         |

None of the public offers examines the documents themselves (a pay stub as a file, a lease against the Civil Code); the ones
that do sell to managers on quote. A Verikora check is an add-on to a credit report, not a replacement: an applicant's file is
about three documents (a lease or offer, two pay stubs).

## Decision

Prices in CAD, **before taxes**: GST 5 % and QST 9,975 % are added on the invoice by the processor (Stripe Tax, ADR-0004), as
the page already says. Monthly only, cancel any time, no annual commitment, no setup fee.

| Plan (catalogue key)               | Price                   | Includes                              |
| ---------------------------------- | ----------------------- | ------------------------------------- |
| One document (`verikora.document`) | **4,99 $** per document | one verification, no subscription     |
| Agency (`verikora.agency`)         | **49 $** a month        | 100 verifications a month             |
| Building manager (`verikora.firm`) | **149 $** a month       | 500 verifications a month             |
| More than 500 a month              | on quote                | a line to the contact form, no figure |

- **The free offer is one dossier a calendar month, renewed on the 1st, no card** (krizaka-internal#45: `plans.free.dossiersPerMonth`, set by the administrator; `audit.freeFirst` switches it off). No timed
  trial: the code has none, and a pilot account gets the same rule. A pilot price, if one is ever needed, is a catalogue entry
  scheduled by the administrator, never a code path.
- **Past the included volume** the account waits until next month (429 `FAIR_USE`): the code bills no usage (#373), so no
  overage figure exists anywhere, and the page says so.
- **What is not built stays « soon » with no figure**: the full applicant file, background checks, the filter alone.
- **The dedicated API** stays an internal entry (never on a public page).

Why these numbers:

- **4,99 $ a document** lets a landlord check one applicant's three documents for about 15 $, half of a single-bureau
  credit report, so it adds to the file instead of competing with it. It is the price the « landlord buys one check » path needs.
- **Agency at 49 $ for 100** pays for itself from the 10th document of the month (about three applicants): the line between an
  occasional landlord and an agency. Below 0,50 $ a verification, it is far under the per-applicant prices above.
- **Building manager at 149 $ for 500** is the step for a manager of several buildings (0,30 $ a verification), a first ticket a
  pilot can say yes to, where 279 $ was not.
- The rules are guarded by `apps/web/lib/pricing.test.ts`: one document is sold without a subscription,
  `9 × document < Agency ≤ 10 × document`, and each step includes more for less per verification.

## How we adjust

The grid is data: the administrator schedules a new price or volume from a date (`/config/prices`), audited; a subscription
keeps the version it was sold at. A changed amount needs its processor price under a new lookup key (this grid is `*_pilot_cad`
in `deploy/payments-catalogue.json`; `pnpm payments:setup` creates them), or the checkout refuses (503 `PRICE_MISMATCH`).
We look again after the first ten paying accounts: how many move from single documents to Agency, and at which document.

## Consequences

- The product is « In development »: the page shows the prices and its action is sign-in; sign-up is closed and the processor
  is in test mode, so nothing is charged yet (krizaka/krizaka-com#468).
- Comparisons on a public page need the source and date of each competitor's figure (krizaka/.github#269); this record holds them.

## Amendment (2026-10-29): a launch offer, as a promo code the administrator creates

Founder decision: « un discount pour les 3 premiers mois pour faire un prix d'appel ». It is **not a price and not a constant**:

- **The offer is a promo code** created by the administrator at `/config/coupons` (`@krizaka/coupons`, ADR-002), e.g. `LANCEMENT`:
  50 %, `duration: repeating` for 3 months, plans `agency` and `firm` (the single document and the free first verification are
  untouched), start and end dates, maximum uses, once per account. Changing it, ending it or creating the next one is the same
  flow; no amount, month count or code is in the code or the messages.
- **The customer enters the code at checkout** (the promo field). The server checks it again and reserves the use; the processor
  receives the discount's immutable terms (Stripe coupon `repeating`, 3 months), so the **4th invoice is the regular price**.
  ADR-002 keeps our database as the source of truth and applies the coupon from terms rather than through a Stripe promotion code
  (a promotion code would duplicate the limits, the dates and the per-account rule in two places); the effect for the customer is
  the same. Test mode only until the owner turns payments live.
- **The pricing page announces it** when the setting `pricing.announcedCode` names a running coupon (active, started, not ended):
  « Offre de lancement : −50 % les 3 premiers mois avec le code LANCEMENT », each plan's line gives the offer price for 3 months and
  **the regular price after**, and the end date is shown (Québec consumer protection: the regular price and the end of the
  offer are always clear). An ended, paused or unknown code announces nothing.
- Guards: `lib/prices/launch-offer.test.ts` (offer price, 4th month at the regular price, EN/FR rendering with the regular price and
  the end date) and `lib/coupons/coupons.integration.test.ts` (valid, once per account, wrong plan, expired).
- **Set up on dev with one command**: `pnpm dev:launch-offer -- --base https://admin.verikora.com` (`scripts/launch-offer.mjs`, idempotent, refuses a
  production base) creates `LANCEMENT` through the admin API and sets `pricing.announcedCode`; the admin credentials come from the environment
  (`QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD`), never the command line. The switch `coupons.enabled` must be on, or a checkout with the code answers
  `COUPON_DISABLED`. Checked on dev with a Stripe test card: Agency 49,00 $ -> 24,50 $ the first month (−50 %, 3 months), tax on the discounted amount.
- Still to build (verikora#548): the administrator's price editor (versions from a date, audit, processor sync in test mode).

## Superseded grid (2026-10-30, krizaka-internal#44)

The founder validated a per-dossier grid, seeded in `lib/pricing.ts` and `deploy/payments-catalogue.json` (all CAD before taxes, all
editable data in `/config/prices`): **Free** 1 dossier a month, no card (`plans.free.dossiersPerMonth`); **one dossier 9,99 $**
(processor key `verikora_dossier_grid_cad`); **Agency 49 $ a month**, 15 dossiers included then 3 $ each; **Building manager 149 $
a month**, 60 dossiers included then 2 $ each (`overageCents`, ADR-0015). Pages say « per dossier ». Agency pays for itself from
the 5th dossier. The 4,99 $ document price, the 100 and 500 volumes and the « no overage » clause above no longer apply.
