import { memoryPriceStore, priceCatalogue, publicCatalogue } from "@krizaka/settings";

import type { Locale } from "@/lib/i18n";

import { PRICES } from "../pricing";
import { pricingLines } from "./page";
import { type PricingPageView } from "./pricing-page-view";

/**
 * The public export's pricing data (aliased over `pricing-page-view` by next.config.public.mjs): the catalogue's seed, read once
 * at build — no database, no session. One card: what is on sale today (the 9.99 $ dossier). What is not built is not announced:
 * no « soon » card (decision of the CTO, krizaka-internal#4148 § 2c).
 */
export async function pricingPageView(locale: Locale, now: Date): Promise<PricingPageView> {
  const catalogue = await priceCatalogue(PRICES, memoryPriceStore()).catalogue(now);
  return { sold: pricingLines(publicCatalogue(catalogue), locale).sold, soon: [], redirectTo: null };
}
