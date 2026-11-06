import { describe, expect, it } from "vitest";

import { addMonths, assertNotProductionBase, OFFER, offerBody } from "./launch-offer.mjs";

describe("the launch offer created through the admin API (verikora#548)", () => {
  it("is -50 % for 3 months on Agence and Gestionnaire, once per account", () => {
    const body = offerBody(new Date("2026-10-29T12:00:00Z"));
    expect(body).toMatchObject({
      code: "LANCEMENT",
      percentOffBp: 5000,
      duration: "repeating",
      durationMonths: 3,
      plans: ["agency", "firm"],
      maxPerAccount: 1,
      endsAt: "2027-01-29T12:00:00.000Z",
    });
  });

  it("ends 3 calendar months after today, clamped to the last day of a short month", () => {
    expect(addMonths(new Date("2026-11-30T00:00:00Z"), OFFER.endsInMonths).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-10-31T00:00:00Z"), 3).toISOString()).toBe("2027-01-31T00:00:00.000Z");
  });

  it("works on dev and local hosts only: the production offer is the founder's", () => {
    expect(() => assertNotProductionBase("http://admin.localhost:3000")).not.toThrow();
    expect(() => assertNotProductionBase("https://admin.verikora.com")).not.toThrow();
    expect(() => assertNotProductionBase("https://verikora.com")).toThrow();
    expect(() => assertNotProductionBase("https://example.com")).toThrow();
  });
});
