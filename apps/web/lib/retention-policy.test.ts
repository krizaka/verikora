import { describe, expect, it } from "vitest";

import { inForce, type Policy, resultDays } from "./retention-policy";

const p = (id: string, purgeOn: Policy["purgeOn"], days: number | null = null): Policy => ({ id, purgeOn, days });

describe("the retention policy in force (yomizaka#125)", () => {
  it("the owner's own rule wins over the global one, which wins over the document type's", () => {
    expect(inForce([{ policy: p("type", "after-decision"), rank: 2 }, { policy: p("global", "after-check"), rank: 1 }, { policy: p("own", "days", 7), rank: 0 }])?.id).toBe("own");
    expect(inForce([{ policy: p("type", "after-decision"), rank: 2 }, { policy: p("global", "after-check"), rank: 1 }])?.id).toBe("global");
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
