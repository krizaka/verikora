import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { purposeOfKey } from "./consent-purpose";

/** Kept from the 0051 migration test (krizaka-internal#2044): the stored purpose of a flow's consent key is runtime behaviour, read by every flow. */
describe("the purpose a consent key is stored under", () => {
  it("keeps a key that is a purpose as it is", () => {
    for (const key of ["marketing", "screening-landlord-undertaking", "reminders", "a_b-9"])
      expect(purposeOfKey(key)).toBe(key);
  });

  it("stores a digit-first key under k-<8 hex of its md5>, always the same, and that name is a purpose", () => {
    const stored = purposeOfKey("2fa-notice");
    expect(stored).toMatch(/^k-[0-9a-f]{8}$/);
    expect(stored).toBe(`k-${createHash("md5").update("2fa-notice").digest("hex").slice(0, 8)}`);
    expect(purposeOfKey("2fa-notice")).toBe(stored);
    expect(purposeOfKey(stored)).toBe(stored);
  });

  it("maps a key too long or not lowercase away from itself", () => {
    expect(purposeOfKey("x".repeat(41))).toMatch(/^k-[0-9a-f]{8}$/);
    expect(purposeOfKey("Marketing")).toMatch(/^k-[0-9a-f]{8}$/);
  });
});
