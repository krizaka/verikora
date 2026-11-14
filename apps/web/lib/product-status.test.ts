import { org } from "@krizaka/org";
import { describe, expect, it } from "vitest";

import { getDictionary } from "./i18n";
import { PRODUCT_STATUS, STATUS_WORD, statusLine } from "./product-status";

// Org rule `product-status-word` (réunion 6, 2026-11-05): one public status, the same word everywhere and equal to krizaka.com's.
describe("the product status word", () => {
  it("is read from @krizaka/org, the company's own record", () => {
    expect(PRODUCT_STATUS).toBe(org.products.find((p) => p.id === "verikora")?.status);
    expect(PRODUCT_STATUS).toBe("development");
  });

  it.each(["en", "fr"] as const)("the landing's status sentence starts with the word « %s » of the status", (locale) => {
    const line = statusLine(getDictionary(locale).landing.status);
    expect(line.startsWith(STATUS_WORD[locale])).toBe(true);
  });

  it("no other status word is public: no dev-preview wording survives", () => {
    for (const locale of ["en", "fr"] as const) {
      const { label, ...sentences } = getDictionary(locale).landing.status as Record<string, string>;
      expect(label).toBeTruthy();
      expect(Object.keys(sentences)).toEqual([PRODUCT_STATUS]);
    }
  });
});
