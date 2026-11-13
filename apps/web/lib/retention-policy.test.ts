import { describe, expect, it } from "vitest";

import {
  DECISION_RETENTION,
  inForce,
  mayKeepAfterDecision,
  type Policy,
  resultDays,
  retainUntilAfterDecision,
} from "./retention-policy";

const p = (id: string, purgeOn: Policy["purgeOn"], days: number | null = null): Policy => ({ id, purgeOn, days });

describe("the retention policy in force (verikora#125)", () => {
  it("the owner's own rule wins over the global one, which wins over the document type's", () => {
    expect(
      inForce([
        { policy: p("type", "after-decision"), rank: 2 },
        { policy: p("global", "after-check"), rank: 1 },
        { policy: p("own", "days", 7), rank: 0 },
      ])?.id,
    ).toBe("own");
    expect(
      inForce([
        { policy: p("type", "after-decision"), rank: 2 },
        { policy: p("global", "after-check"), rank: 1 },
      ])?.id,
    ).toBe("global");
    expect(inForce([{ policy: p("type", "after-decision"), rank: 2 }])?.id).toBe("type");
  });
  it("says nothing when no row does", () => {
    expect(inForce([])).toBeNull();
  });
  it("keeps a result for the days of a « days » policy and for none otherwise (short by default)", () => {
    expect(resultDays(p("thirty-days", "days", 30))).toBe(30);
    expect(resultDays(p("x", "after-check"))).toBe(0);
    expect(resultDays(null)).toBe(0);
  });
});

describe("the « one year after the decision » class (Law 25, s. 11)", () => {
  it("has its own key, apart from the default « at the decision »", () => {
    expect(DECISION_RETENTION.oneYear).toBe("one-year-after-decision");
    expect(DECISION_RETENTION.atDecision).toBe("at-decision");
  });
  it("is allowed only where the admin's policy keeps a document past the check", () => {
    expect(mayKeepAfterDecision(p("a", "after-decision"))).toBe(true);
    expect(mayKeepAfterDecision(p("b", "after-decision-days", 365))).toBe(true);
    expect(mayKeepAfterDecision(p("c", "after-check"))).toBe(false);
    expect(mayKeepAfterDecision(p("d", "days", 30))).toBe(false);
    expect(mayKeepAfterDecision(null)).toBe(false);
  });
  it("keeps a document until the decision plus the policy's days, to the second", () => {
    expect(retainUntilAfterDecision(new Date("2026-10-24T12:00:00Z"), 365).toISOString()).toBe(
      "2027-10-24T12:00:00.000Z",
    );
  });
});
