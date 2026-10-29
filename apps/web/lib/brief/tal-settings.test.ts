import { describe, expect, it } from "vitest";

import { checkSectionG } from "../rules/section-g";
import { TAL } from "./tal";
import { talTableFrom, withTalRate } from "./tal-settings";

const rate = { year: 2026, basisPoints: 310, sourceUrl: "https://www.quebec.ca/nouvelles/actualites/details/le-calcul-de-lajustement-des-loyers-en-2026-68053", enteredOn: "2026-10-29" };

describe("the TAL rate kept in the settings", () => {
  it("lays the administrator's rate over the shipped table, with its source and day", () => {
    const t = withTalRate(TAL, rate);
    expect(t.years.find((y) => y.year === 2026)).toMatchObject({ enteredOn: "2026-10-29", sourceUrl: rate.sourceUrl, components: [{ kind: "rate-of-rent", basisPoints: 310 }] });
    expect(t.windows).toEqual(TAL.windows);
  });

  it("replaces the entry of the same year, never duplicates it", () => {
    const t = withTalRate(withTalRate(TAL, rate), { ...rate, basisPoints: 450 });
    expect(t.years.filter((y) => y.year === 2026)).toHaveLength(1);
  });

  it("enters nothing when the rate is 0 or the source is unreadable: no claim follows", () => {
    expect(withTalRate(TAL, { ...rate, basisPoints: 0 })).toBe(TAL);
    expect(withTalRate(TAL, { ...rate, sourceUrl: "" })).toBe(TAL);
    expect(checkSectionG({ newRentCents: 99_000, previousRent: { kind: "stated", cents: 92_500 }, year: 2026 }, withTalRate(TAL, { ...rate, basisPoints: 0 }))).toMatchObject({ status: "no-claim" });
  });

  it("reads the four settings", async () => {
    const values: Record<string, unknown> = { "tal.rate.year": 2026, "tal.rate.basisPoints": 310, "tal.rate.sourceUrl": rate.sourceUrl, "tal.rate.enteredOn": rate.enteredOn };
    const t = await talTableFrom({ get: async (k) => values[k] }, TAL);
    // the demo cast's lease: 925,00 $ -> 950,00 $ is +2,7 %, within the 3,1 % base; 925,00 $ -> 990,00 $ is above it
    expect(checkSectionG({ newRentCents: 95_000, previousRent: { kind: "stated", cents: 92_500 }, year: 2026 }, t)).toMatchObject({ status: "ok", code: "within-rate", figures: { maxRentCents: 95_368 } });
    expect(checkSectionG({ newRentCents: 99_000, previousRent: { kind: "stated", cents: 92_500 }, year: 2026 }, t)).toMatchObject({ status: "finding", code: "over-rate", figures: { excessCents: 3_632 } });
  });
});
