import { afterEach, describe, expect, it } from "vitest";

import { formatDate } from "../components/console/format";

const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

/**
 * The console's dates are drawn by the server and again by the browser. In the machine's own time zone the two disagree
 * (a server on UTC, an operator in Montréal) and React refuses the page (hydration error #418): a date is always written
 * in Montréal's time zone, whoever draws it.
 */
describe("formatDate", () => {
  const instant = "2026-10-19T02:30:00Z";
  it("writes the same text in every time zone of the machine", () => {
    const seen = new Set<string>();
    for (const zone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = zone;
      seen.add(formatDate(instant, "en", true));
    }
    expect([...seen]).toHaveLength(1);
  });
  it("writes Montréal's day, not UTC's", () => {
    process.env.TZ = "UTC";
    expect(formatDate(instant, "en")).toContain("18");
    expect(formatDate(instant, "fr")).toContain("18");
  });
  it("writes a date-only value as the calendar day it names, in every time zone (krizaka-internal#3984)", () => {
    for (const zone of ["America/Montreal", "UTC", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      expect(formatDate("2026-11-16", "en")).toContain("16");
      expect(formatDate("2026-11-16", "fr")).toContain("16");
    }
  });
});
