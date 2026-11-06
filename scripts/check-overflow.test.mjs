import { describe, expect, it } from "vitest";

import { PAGES, WIDTHS } from "./check-overflow.mjs";

// verikora#486: /docs was broken (cut text, content under the bar, flat headings) and no guard looked at it, because the
// responsive audit only listed the home, privacy and sign-in. A public page the audit does not list is a page nobody measures.
describe("the responsive audit lists the documentation", () => {
  it("measures /docs in both languages", () => {
    expect(PAGES).toEqual(expect.arrayContaining(["/en/docs", "/fr/docs"]));
  });
  it("measures a phone width", () => {
    expect(Math.min(...WIDTHS)).toBeLessThanOrEqual(390);
  });
});
