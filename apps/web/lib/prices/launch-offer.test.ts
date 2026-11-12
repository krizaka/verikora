import type { Query } from "@krizaka/db";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PricingContent } from "@/components/pricing/PricingContent";

import { format, getDictionary } from "../i18n";
import { activeLaunchOffer, billedOnMonth, type LaunchOffer, offerLines, offerPrices } from "./launch-offer";

const OFFER: LaunchOffer = {
  code: "LANCEMENT",
  percent: 50,
  months: 3,
  plans: ["agency", "firm"],
  endsAt: new Date("2027-01-31T04:59:59Z"),
};
const PLANS = [
  { plan: "document", amountCents: 499 },
  { plan: "agency", amountCents: 4900 },
  { plan: "firm", amountCents: 14900 },
];

describe("the launch offer is a promo code the admin created (#548, ADR-0013)", () => {
  it("halves the monthly plans for 3 months and leaves the single document alone", () => {
    const prices = offerPrices(OFFER, PLANS);
    expect(prices.map((p) => [p.plan, p.offerCents, p.regularCents])).toEqual([
      ["agency", 2450, 4900],
      ["firm", 7450, 14900],
    ]);
  });

  it("bills the 4th month at the regular price", () => {
    const [agency] = offerPrices(OFFER, PLANS);
    expect([1, 2, 3, 4, 5].map((n) => billedOnMonth(agency!, n))).toEqual([2450, 2450, 2450, 4900, 4900]);
  });

  it("an offer without plans applies to every plan it is given (the page gives it the subscriptions), a free entry to none", () => {
    expect(
      offerPrices({ ...OFFER, plans: [] }, [...PLANS.slice(1), { plan: "free", amountCents: 0 }]).map((p) => p.plan),
    ).toEqual(["agency", "firm"]);
  });

  it("announces nothing without a code, and reads the coupon's window and status from the database", async () => {
    const seen: unknown[][] = [];
    const query = (async (sql: string, values: unknown[]) => {
      seen.push(values);
      expect(sql).toMatch(/status = 'active'[\s\S]*starts_at <= \$2 AND \(ends_at IS NULL OR ends_at > \$2\)/);
      return [{ code: "LANCEMENT", percent_off_bp: 5000, duration_months: 3, plans: ["agency"], ends_at: null }];
    }) as unknown as Query;
    const now = new Date("2026-11-01T00:00:00Z");
    expect(await activeLaunchOffer(query, "  ", now)).toBeNull();
    expect(await activeLaunchOffer(query, "lancement", now)).toEqual({
      code: "LANCEMENT",
      percent: 50,
      months: 3,
      plans: ["agency"],
      endsAt: null,
    });
    expect(seen).toEqual([["lancement", now]]);
    const none = (async () => []) as unknown as Query;
    expect(await activeLaunchOffer(none, "EXPIRED", now)).toBeNull();
  });

  it.each(["en", "fr"] as const)(
    "shows the code, the offer price, the regular price and the end of the offer (%s)",
    (locale) => {
      const launch = offerLines(OFFER, offerPrices(OFFER, PLANS), locale, getDictionary(locale).pricing.offer, format);
      const html = renderToStaticMarkup(
        PricingContent({
          locale,
          sold: [{ plan: "agency", price: "49", per: "month", included: 15, overage: null }],
          soon: [],
          launch,
          status: "x",
        }),
      );
      const text = html.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s/gu, " ");
      expect(text).toContain("LANCEMENT");
      expect(text).toContain(locale === "en" ? "$24.50" : "24,50");
      expect(text).toContain(locale === "en" ? "$49.00" : "49,00");
      expect(text).toMatch(/2027|janvier|January/);
    },
  );
});
