import { describe, expect, it } from "vitest";

import { getDictionary } from "./i18n";
import { llmsText, siteJsonLd } from "./seo";
import { LICENSE_ID, LICENSE_URL } from "./site";

/** The words of the public pages (krizaka-internal#4148): one sentence, one licence, no promise the product cannot keep. */
const LOCALES = ["en", "fr"] as const;
const SENTENCE = {
  fr: "Vérifiez le dossier avant d'offrir le logement",
  en: "Check the file before you offer the unit",
} as const;
const REFUSED =
  /Apache|\bMIT\b|open[- ]source|\blibre\b|audit gratuit|free audit|coming soon|bientôt|lisez avant de signer/i;

describe("the words of the public pages", () => {
  it.each(LOCALES)("%s: the hero and the meta description state the sentence", (locale) => {
    const t = getDictionary(locale);
    expect(t.landing.title).toContain(SENTENCE[locale]);
    expect(t.meta.description).toContain(SENTENCE[locale]);
  });

  it("names only the licence of the file, with a link to it", () => {
    expect(LICENSE_ID).toBe("FSL-1.1-ALv2");
    expect(LICENSE_URL).toMatch(/\/LICENSE\.md$/);
    const llms = llmsText();
    expect(llms).toContain(LICENSE_ID);
    expect(llms).toContain(LICENSE_URL);
    expect(llms).not.toMatch(REFUSED);
    expect(JSON.stringify(siteJsonLd("en"))).not.toMatch(REFUSED);
    for (const locale of LOCALES) expect(getDictionary(locale).chrome.license).toContain(LICENSE_ID);
  });
});
