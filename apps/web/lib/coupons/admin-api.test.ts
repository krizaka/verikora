import { describe, expect, it } from "vitest";

import { pilotFallsBackToPaid } from "./admin-api";
import { couponPayload, emptyCouponForm } from "./form";

describe("a pilot code falls back to the account's paid credits once its free files are used", () => {
  it("forces fallback_paid on a pilot (purpose demo), whatever was typed", () => {
    expect(pilotFallsBackToPaid("demo", { onExhausted: "stop", credits: 1 })).toEqual({
      onExhausted: "fallback_paid",
      credits: 1,
    });
  });
  it("leaves any other purpose, and a patch that does not touch the rule, as it is", () => {
    expect(pilotFallsBackToPaid("promo", { onExhausted: "stop" })).toEqual({ onExhausted: "stop" });
    expect(pilotFallsBackToPaid("demo", {})).toEqual({});
  });
  it("the create form sends fallback_paid for a pilot credit code", () => {
    const form = {
      ...emptyCouponForm("2026-11-13"),
      kind: "credit" as const,
      purpose: "demo" as const,
      code: "PILOT-1",
    };
    expect(couponPayload(form)).toMatchObject({ purpose: "demo", onExhausted: "fallback_paid" });
    expect(couponPayload({ ...form, purpose: "promo" })).toMatchObject({ onExhausted: "stop" });
  });
});
