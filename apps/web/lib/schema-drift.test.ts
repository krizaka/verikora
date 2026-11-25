import { describe, expect, it } from "vitest";

import { driftReport } from "./schema-drift";

const expected = { tables: { "public.accounts": ["email", "id"] }, config: { "public.check_type": ["credit"] } };

describe("the nightly schema drift report", () => {
  it("says « no drift » and does not fail when the live schema is the expected one", () => {
    expect(driftReport(expected, expected)).toEqual({ drifted: false, line: "no drift" });
  });

  it("lists every problem on one line and fails on drift", () => {
    const actual = { tables: { "public.accounts": ["id"], "public.extra": ["x"] }, config: expected.config };
    const report = driftReport(expected, actual);
    expect(report.drifted).toBe(true);
    expect(report.line).toBe("drift: missing column public.accounts.email; unexpected table public.extra");
  });
});
