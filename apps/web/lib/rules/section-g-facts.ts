import type { ReportFact } from "@yomizaka/core";

import type { SectionGInput } from "./section-g";

/**
 * Section G's input from the figures the lease ruleset exposes (`facts` of the report, orazaka-packs `qc-residential-lease`).
 * Nothing is guessed: no readable rent gives no claim; a lowest rent that is blank, or not there at all, is a blank Section G.
 * The year is the report's own date (`asOf`), the day the lease was read, which is when the TAL's rate in force applies.
 */
export function sectionGInputFromFacts(facts: Readonly<Record<string, ReportFact>> | undefined, asOf: string): SectionGInput | null {
  const rent = facts?.rentCents;
  if (!rent || !("cents" in rent)) return null;
  const year = /^\d{4}-\d{2}-\d{2}/.test(asOf) ? Number(asOf.slice(0, 4)) : 0;
  if (year < 2000) return null;
  const lowest = facts?.lowestRentCents;
  return { newRentCents: rent.cents, previousRent: lowest && "cents" in lowest ? { kind: "stated", cents: lowest.cents } : { kind: "blank" }, year };
}
