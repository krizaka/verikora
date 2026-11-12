import { AVAILABILITY, definePrices, UNIT } from "@krizaka/settings";

/**
 * Verikora's price catalogue — its SEED (ADR-009, krizaka/.github#253, verikora#367). Prices are data: the administrator
 * schedules a change from a date on admin.verikora.com (`/config/prices`), every change is audited, a subscription keeps the
 * version it was sold at. These are only the defaults, the grid of ADR-0013 (CAD, plus taxes — the processor adds GST and QST).
 * Nothing but the catalogue (`lib/prices/catalogue.ts`) reads this module; pages, the paywall and the checkout read the catalogue.
 */
export const PRICE = {
  /** One dossier verified, paid per dossier (the applicant's documents of the month are one dossier, ADR-0015). */
  document: "verikora.document",
  /** Agencies and landlords with several files: a month, with verifications included. NOT on sale (founder, 2026-11-12): « soon », no amount shown; the figures stay for the accounts already on it. */
  agency: "verikora.agency",
  /** Building managers and firms: a month, with more verifications included. NOT on sale, like `agency`. */
  firm: "verikora.firm",
  /** A dedicated API over 5 000 verifications a month: on quote; its internal target per document, never on a public page. */
  api: "verikora.api",
  /** In preparation (no figure): the full applicant file, background checks, screening alone. */
  fullFile: "verikora.fullFile",
  backgroundCheck: "verikora.backgroundCheck",
  screening: "verikora.screening",
} as const;
export type PriceKey = (typeof PRICE)[keyof typeof PRICE];

/**
 * The named limits an entry holds: the dossiers a month includes, and the price of each dossier beyond them (`overageCents`, before
 * taxes). The rate is the administrator's, versioned with the entry (a subscription keeps the rate it was sold at) and BILLED by
 * `lib/overage.ts` (ADR-0015): an entry without one holds the account at its volume until next month (429 `FAIR_USE`). No page
 * shows a rate the code does not charge (`lib/prices/billed-charges.test.ts`).
 */
export const LIMIT = { included: "included", overage: "overageCents" } as const;

export const PRICES = definePrices([
  { product: "verikora", plan: "document", unit: UNIT.document, amountCents: 999, availability: AVAILABILITY.public },
  {
    product: "verikora",
    plan: "agency",
    unit: UNIT.month,
    amountCents: 4900,
    availability: AVAILABILITY.preparing,
    limits: { [LIMIT.included]: 15, [LIMIT.overage]: 300 },
  },
  {
    product: "verikora",
    plan: "firm",
    unit: UNIT.month,
    amountCents: 14900,
    availability: AVAILABILITY.preparing,
    limits: { [LIMIT.included]: 60, [LIMIT.overage]: 200 },
  },
  { product: "verikora", plan: "api", unit: UNIT.document, amountCents: 22, availability: AVAILABILITY.internal },
  {
    product: "verikora",
    plan: "fullFile",
    unit: UNIT.document,
    amountCents: null,
    availability: AVAILABILITY.preparing,
  },
  {
    product: "verikora",
    plan: "backgroundCheck",
    unit: UNIT.document,
    amountCents: null,
    availability: AVAILABILITY.preparing,
  },
  {
    product: "verikora",
    plan: "screening",
    unit: UNIT.document,
    amountCents: null,
    availability: AVAILABILITY.preparing,
  },
]);

/**
 * What the processor sells, by checkout kind: the catalogue entry it charges and the processor's price (its lookup key, the
 * same as `deploy/payments-catalogue.json`; `lib/pricing.test.ts` keeps the amounts equal to the seed). A changed amount in the
 * catalogue needs a new processor price under a new key — the checkout refuses while the two differ.
 */
export const SOLD = {
  document: { key: PRICE.document, lookupKey: "verikora_dossier_grid_cad", mode: "payment" },
  agency: { key: PRICE.agency, lookupKey: "verikora_agency_monthly_pilot_cad", mode: "subscription" },
  firm: { key: PRICE.firm, lookupKey: "verikora_firm_monthly_pilot_cad", mode: "subscription" },
} as const;
export type SoldKind = keyof typeof SOLD;
export const SOLD_KINDS = Object.keys(SOLD) as SoldKind[];
export const isSoldKind = (v: string): v is SoldKind => (SOLD_KINDS as string[]).includes(v);
/** The subscription a subscribed account is on when it recorded none (one sold before the catalogue): the first plan. */
export const DEFAULT_SUBSCRIPTION: SoldKind = "agency";
