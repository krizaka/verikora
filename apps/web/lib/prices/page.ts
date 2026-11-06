import { AVAILABILITY, type PublicPrice } from "@krizaka/settings";

import { LIMIT } from "../pricing";
import { money } from "./format";

/**
 * One plan of the pricing page, from the public catalogue: its entry (the words are `pricing.plans.<plan>`), its figure and
 * the verifications it includes. A volume above the included one is NOT priced here: the code does not bill it (verikora#373),
 * so the catalogue holds no such figure and the page cannot show one.
 */
export interface PricingPlan {
  plan: string;
  price: string;
  /** Per month for a subscription, per document otherwise. */
  per: "month" | "dossier";
  included: number | null;
  /** The price of each dossier past the included volume, formatted; null where none is billed (the account waits). */
  overage: string | null;
}

/** An entry in preparation: a name and « soon », never a figure. */
export interface PricingSoon {
  plan: string;
}

/**
 * The pricing page from the public catalogue (`publicCatalogue`: never an internal entry): what is on sale with its figure — one
 * document, then the subscriptions with what they include —, and what is not built yet, without a figure. Nothing here is typed:
 * every amount is the catalogue's.
 */
export function pricingLines(
  prices: readonly PublicPrice[],
  locale: "en" | "fr",
): { sold: PricingPlan[]; soon: PricingSoon[] } {
  const onSale = prices.filter(
    (p) =>
      p.amountCents !== null &&
      (p.availability === AVAILABILITY.public || p.availability === AVAILABILITY.founderLimited),
  );
  const plan = (p: PublicPrice): PricingPlan => ({
    plan: p.plan,
    price: money(p.amountCents!, locale),
    per: p.unit === "month" || p.unit === "year" ? "month" : "dossier",
    included: p.limits[LIMIT.included] ?? null,
    overage: p.limits[LIMIT.overage] ? money(p.limits[LIMIT.overage]!, locale) : null,
  });
  const perDocument = onSale.filter((p) => p.unit !== "month" && p.unit !== "year").map(plan);
  const subscriptions = onSale.filter((p) => p.unit === "month" || p.unit === "year").map(plan);
  return {
    sold: [...perDocument, ...subscriptions],
    soon: prices.filter((p) => p.availability === AVAILABILITY.preparing).map((p) => ({ plan: p.plan })),
  };
}
