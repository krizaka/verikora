import { type Catalogue, ensureCatalogue, type SetupResult, type StripeCall } from "@krizaka/payments";

import { SOLD, SOLD_KINDS, type SoldKind } from "../pricing";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * Keeps the processor's prices equal to the catalogue the administrator edits (yomizaka#548). The catalogue (`@krizaka/settings`) is the
 * source of truth; the processor only holds what is sold. `ensureCatalogue` is idempotent by lookup key: an equal price is left alone, a
 * different amount creates a NEW processor price and moves the lookup key to it, so a subscription already sold keeps the price it was
 * sold at (the old price is never edited). Live mode is the owner's: this module never passes `owner`, so a live key is refused.
 */
// The product's name at the processor and its tax code: the same as deploy/payments-catalogue.json (guarded by price-sync.test.ts).
export const PROCESSOR_PLANS: Record<SoldKind, { name: string; taxCode: string }> = {
  document: { name: `${PRODUCT_NAME} — one dossier verified`, taxCode: "txcd_10103001" },
  agency: { name: `${PRODUCT_NAME} Agency — monthly`, taxCode: "txcd_10103001" },
  firm: { name: `${PRODUCT_NAME} Building manager — monthly`, taxCode: "txcd_10103001" },
};
export const PORTAL = { headline: `Manage your ${PRODUCT_NAME} subscription and invoices`, cancel: "at_period_end" } as const;

/** What of a catalogue entry the sync needs (`describePrices` entries satisfy it). */
export interface SyncEntry {
  key: string;
  amountCents: number | null;
  currency: string;
}

/** The processor catalogue for the entries in force: every sold plan that has a figure (an « on quote » entry is not sold, so it has no price). */
export function processorCatalogue(entries: readonly SyncEntry[]): Catalogue {
  const plans = SOLD_KINDS.flatMap((kind) => {
    const entry = entries.find((e) => e.key === SOLD[kind].key);
    if (entry?.amountCents == null) {
      return [];
    }
    const { name, taxCode } = PROCESSOR_PLANS[kind];
    return [
      {
        lookupKey: SOLD[kind].lookupKey,
        name,
        amount: entry.amountCents,
        currency: entry.currency.toLowerCase(),
        taxCode,
        ...(SOLD[kind].mode === "subscription" ? { interval: "month" as const } : {}),
      },
    ];
  });
  return { product: "yomizaka", plans, portal: PORTAL };
}

export type PriceSync = Pick<SetupResult, "prices"> & { mode: "test" | "live" };

/** Brings the processor to the catalogue. Refuses a live key (the owner's decision), before any call that writes. */
export async function syncProcessorPrices(
  stripe: { call: StripeCall; mode: "test" | "live" },
  entries: readonly SyncEntry[],
): Promise<PriceSync> {
  if (stripe.mode === "live") {
    throw new LiveRefused();
  }
  const result = await ensureCatalogue(stripe.call, processorCatalogue(entries), { mode: stripe.mode });
  return { mode: stripe.mode, prices: result.prices };
}

export class LiveRefused extends Error {
  constructor() {
    super("The processor is in live mode: its prices are changed by the owner, not from here");
    this.name = "LiveRefused";
  }
}
