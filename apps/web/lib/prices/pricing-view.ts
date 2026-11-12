import { publicCatalogue } from "@krizaka/settings";

import { query } from "@/lib/db";
import { format, getDictionary, type Locale } from "@/lib/i18n";
import { appPrices } from "@/lib/prices/catalogue";
import { activeLaunchOffer, offerLines, offerPrices } from "@/lib/prices/launch-offer";
import { pricingLines, type PricingPlan, type PricingSoon } from "@/lib/prices/page";
import { appSettings } from "@/lib/settings/instance";

export interface PricingView {
  sold: PricingPlan[];
  soon: PricingSoon[];
  launch?: { headline: string; ends: string; lines: { plan: string; text: string }[] };
}

/**
 * The offers as data, read from the catalogue in force (never an internal entry, an entry in preparation without its figure —
 * ADR-009), the announced launch offer. One reader for the public page and the in-app plans page,
 * so a signed-in user is shown the very grid a visitor sees.
 */
export async function pricingView(locale: Locale, now: Date): Promise<PricingView> {
  const [prices, announced] = await Promise.all([
    appPrices().catalogue(now),
    appSettings().get("pricing.announcedCode"),
  ]);
  const publicPrices = publicCatalogue(prices);
  const { sold, soon } = pricingLines(publicPrices, locale);
  const offer = announced ? await activeLaunchOffer(query, announced, now) : null;
  const subscriptions = publicPrices.flatMap((p) =>
    (p.unit === "month" || p.unit === "year") && p.amountCents !== null
      ? [{ plan: p.plan, amountCents: p.amountCents }]
      : [],
  );
  const launch = offer
    ? offerLines(offer, offerPrices(offer, subscriptions), locale, getDictionary(locale).pricing.offer, format)
    : undefined;
  return { sold, soon, launch };
}
