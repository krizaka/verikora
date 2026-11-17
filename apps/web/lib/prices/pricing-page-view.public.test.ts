import { describe, expect, it } from "vitest";

import { pricingPageView } from "./pricing-page-view.public";

/** The public export's pricing (krizaka-internal#4148 § 2c): one card, the catalogue's 9.99 $, no « soon », nobody redirected. */
describe("the public export's pricing data", () => {
  it.each(["fr", "en"] as const)("is one card at the catalogue's price, in %s", async (locale) => {
    const view = await pricingPageView(locale, new Date("2026-11-17T12:00:00Z"));
    expect(view.sold.map((p) => p.plan)).toEqual(["document"]);
    expect(view.sold[0]?.price).toMatch(/^(\$9\.99|9,99\s\$)$/);
    expect(view.soon).toEqual([]);
    expect(view.redirectTo).toBeNull();
  });
});
