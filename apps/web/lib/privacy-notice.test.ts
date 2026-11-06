import { describe, expect, it } from "vitest";

import { getDictionary } from "./i18n";

/** The privacy notice (verikora#457): sections with a heading and a short paragraph, the processors, the retention, the rights and the contact — never one block. */
describe("the privacy notice", () => {
  for (const locale of ["en", "fr"] as const) {
    const notice = getDictionary(locale).privacy;
    it(`${locale}: is split into short sections, with the summary short too`, () => {
      expect(notice.sections.length).toBeGreaterThanOrEqual(8);
      expect(notice.body.length).toBeLessThan(220);
      for (const section of notice.sections) {
        expect(section.h.trim()).not.toBe("");
        expect(section.p.length).toBeLessThan(420);
      }
    });
  }
  it("has the same sections in both languages", () => {
    expect(getDictionary("en").privacy.sections).toHaveLength(getDictionary("fr").privacy.sections.length);
  });
});
