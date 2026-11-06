import { describe, expect, it } from "vitest";

import { base64Of, bytesOf } from "./desktop";

// Sonar S7758 (verikora#406): the bytes of a file go through a binary string; every value from 0 to 255 must come back as it went.
describe("bytes and base64", () => {
  it("round-trip every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...bytesOf(base64Of(all))]).toEqual([...all]);
  });
  it("write a known value", () => {
    expect(base64Of(new TextEncoder().encode("%PDF-"))).toBe("JVBERi0=");
    expect([...bytesOf("JVBERi0=")]).toEqual([37, 80, 68, 70, 45]);
  });
});
