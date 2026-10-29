import { complianceReport } from "@yomizaka/core";
import { describe, expect, it } from "vitest";

import { sectionGInputFromFacts } from "./section-g-facts";

const found = (cents: number) => ({ status: "found" as const, cents });

describe("Section G input from the report's facts", () => {
  it("reads the rent and the stated lowest rent", () => {
    expect(sectionGInputFromFacts({ rentCents: found(145000), lowestRentCents: found(139000) }, "2026-10-15")).toEqual({ newRentCents: 145000, previousRent: { kind: "stated", cents: 139000 }, year: 2026 });
  });
  it("a labelled-but-empty or missing lowest rent is a blank Section G", () => {
    expect(sectionGInputFromFacts({ rentCents: found(145000), lowestRentCents: { status: "blank" } }, "2026-10-15")?.previousRent).toEqual({ kind: "blank" });
    expect(sectionGInputFromFacts({ rentCents: found(145000), lowestRentCents: { status: "absent" } }, "2026-10-15")?.previousRent).toEqual({ kind: "blank" });
    expect(sectionGInputFromFacts({ rentCents: found(145000) }, "2026-10-15")?.previousRent).toEqual({ kind: "blank" });
  });
  it("makes no claim without a readable rent or a usable date, nor for a report without facts", () => {
    expect(sectionGInputFromFacts({ rentCents: { status: "absent" } }, "2026-10-15")).toBeNull();
    expect(sectionGInputFromFacts({ rentCents: found(100000) }, "")).toBeNull();
    expect(sectionGInputFromFacts(undefined, "2026-10-15")).toBeNull();
  });
});

describe("the report's facts in the core schema", () => {
  const base = { rulesetId: "qc-residential-lease", rulesetVersion: "1", jurisdiction: "QC", asOf: "2026-10-15", findings: [] };
  it("reads found, blank and absent facts", () => {
    const parsed = complianceReport.parse({ ...base, facts: { rentCents: { status: "found", cents: 1, evidenceSpan: { start: 1, end: 2, quote: "q" } }, lowestRentCents: { status: "absent" } } });
    expect(parsed.facts?.rentCents?.status).toBe("found");
  });
  it("drops a shape it does not know instead of losing the report", () => {
    const parsed = complianceReport.parse({ ...base, facts: { rentCents: { status: "maybe" } } });
    expect(parsed.facts).toBeUndefined();
    expect(parsed.rulesetId).toBe("qc-residential-lease");
  });
});
