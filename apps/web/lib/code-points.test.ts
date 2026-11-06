import { describe, expect, it } from "vitest";

import { looksLikePdf } from "./pdf-text";
import { normaliseQuery } from "./search";
import { safeNext } from "./site";

// Sonar S7758 (verikora#406): code points, not UTF-16 units. Each case pins what the code did before, for text outside the Basic Multilingual Plane too.
describe("control characters are found by code point", () => {
  it("normaliseQuery turns a control character into a space, and keeps emoji and accents whole", () => {
    expect(normaliseQuery("bail\u0000 1\u001f 🏠 é")).toBe("bail  1  🏠 é");
    expect(normaliseQuery("  a\tb  ")).toBe("a b");
    expect(normaliseQuery("x".repeat(300))).toHaveLength(200);
  });
  it("safeNext refuses a path with a control character, and lets an emoji through", () => {
    expect(safeNext("/fr/app/a\u0007b", "fr")).toBe("/fr/app");
    expect(safeNext("/fr/app/🏠", "fr")).toBe("/fr/app/🏠");
    expect(safeNext("//evil.test", "fr")).toBe("/fr/app");
  });
});

describe("a PDF is recognised by its first five bytes", () => {
  it("accepts %PDF- and refuses anything else, whatever the bytes", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7 ..."))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("%PDF"))).toBe(false);
    expect(looksLikePdf(new Uint8Array([255, 216, 255, 224, 0, 16]))).toBe(false);
  });
});
