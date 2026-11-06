import { type PriceCatalogue, priceCatalogue, priceStore } from "@krizaka/settings";

import { query } from "../db";
import { PRICES } from "../pricing";

/** One catalogue per process, shared by every bundle (pages and routes are bundled apart): a change scheduled in a route is read by the next page. */
const holder = globalThis as unknown as { __verikoraPrices?: PriceCatalogue };

/** This deployment's price catalogue: the seed of `lib/pricing.ts` and the versions an administrator scheduled, in the app's PostgreSQL. */
export function appPrices(): PriceCatalogue {
  holder.__verikoraPrices ??= priceCatalogue(
    PRICES,
    priceStore({ query: (sql, params) => query(sql, params) as never }),
  );
  return holder.__verikoraPrices;
}

/** For tests: forget the cached catalogue. */
export const resetAppPrices = () => {
  holder.__verikoraPrices = undefined;
};
