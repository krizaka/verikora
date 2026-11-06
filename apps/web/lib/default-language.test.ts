import { describe, expect, it } from "vitest";

import { asLocale, otherLocale } from "./i18n";
import { llmsText, pageMetadata } from "./seo";
import { SITE_URL } from "./site";

// verikora#366 (Loi 96): French is the default language of the product; English stays available by choice.
describe("French by default (verikora#366)", () => {
  it("reads an unknown or missing language as French, and English only when asked", () => {
    expect(asLocale(undefined)).toBe("fr");
    expect(asLocale("")).toBe("fr");
    expect(asLocale("de")).toBe("fr");
    expect(asLocale("fr")).toBe("fr");
    expect(asLocale("en")).toBe("en");
  });
  it("offers the other language on the switch", () => {
    expect(otherLocale("fr")).toBe("en");
    expect(otherLocale("en")).toBe("fr");
  });
  it("sends search engines without a language to the French page (hreflang x-default), English kept as an alternate", () => {
    for (const locale of ["fr", "en"] as const) {
      const languages = pageMetadata(locale, "home").alternates?.languages as Record<string, string>;
      expect(languages["x-default"]).toBe(`${SITE_URL}/fr`);
      expect(languages.en).toBe(`${SITE_URL}/en`);
      expect(languages.fr).toBe(`${SITE_URL}/fr`);
    }
  });
  it("lists the French page first in llms.txt", () => {
    const text = llmsText();
    expect(text.indexOf(`${SITE_URL}/fr)`)).toBeGreaterThan(-1);
    expect(text.indexOf(`${SITE_URL}/fr`)).toBeLessThan(text.indexOf(`${SITE_URL}/en`));
    expect(text).toContain("Languages: French and English.");
  });
});
