import { PRICE } from "../pricing";
import { money } from "./format";

/** A price on sale as the BFF sends it (`/api/billing`, from `publicCatalogue`). */
export interface SoldPrice {
  key: string;
  amountCents: number | null;
  limits: Record<string, number>;
}

/** The paywall's figure, from the catalogue: the price of one dossier (the subscriptions are « soon », no figure). Null while it is missing (nothing is guessed). */
export function paywallFigures(prices: readonly SoldPrice[], locale: "en" | "fr"): { document: string } | null {
  const document = prices.find((p) => p.key === PRICE.document)?.amountCents;
  return document == null ? null : { document: money(document, locale) };
}
