import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDictionary } from "./i18n";

/*
 * The privacy page says what the site does (krizaka-internal#3308, #4148): the public site has no account, receives no document and
 * asks for nothing; the only way in is Krizaka's contact form; the complaint path and the privacy officer's role address are on the page.
 */
const ROOT = join(__dirname, "..");
const LOCALES = ["en", "fr"] as const;

const sectionOf = (locale: (typeof LOCALES)[number], id: string) => {
  const s = getDictionary(locale).privacy.sections.find((x) => x.id === id);
  if (!s) throw new Error(`no section « ${id} » in ${locale}`);
  return `${s.h} ${s.p}`;
};
const allText = (locale: (typeof LOCALES)[number]) => JSON.stringify(getDictionary(locale).privacy);

describe("the privacy page says what the site does", () => {
  it("every section has an anchor, the same in both languages and in the same order", () => {
    const ids = (locale: (typeof LOCALES)[number]) => getDictionary(locale).privacy.sections.map((s) => s.id);
    expect(ids("fr")).toEqual(ids("en"));
    expect(new Set(ids("en")).size).toBe(ids("en").length);
    for (const id of ids("en")) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  it("the page renders each section with its anchor", () => {
    const page = readFileSync(join(ROOT, "app/[locale]/privacy/page.tsx"), "utf8");
    expect(page).toContain("id={s.id}");
  });

  it.each([
    ["en", /no account/i, /no document/i],
    ["fr", /pas de compte/i, /aucun document/i],
  ] as const)("%s: a site with no account and no document", (locale, account, document) => {
    expect(getDictionary(locale).privacy.body).toMatch(account);
    expect(sectionOf(locale, "documents")).toMatch(document);
  });

  it.each(LOCALES)(
    "%s: says nothing of accounts' data, storage places or purges, which this site does not have",
    (locale) => {
      expect(allText(locale)).not.toMatch(
        /Toronto|United States|États-Unis|development store|stockage de développement|purg|receipt|reçu|Stripe|Mailgun/i,
      );
    },
  );

  it.each(LOCALES)("%s: the contact form is the way in, and the complaint goes to the Commission", (locale) => {
    expect(sectionOf(locale, "collected")).toContain("krizaka.com/contact");
    expect(sectionOf(locale, "complaints")).toMatch(/Commission d.accès à l.information/);
  });

  it.each(LOCALES)(
    "%s: no e-mail address in the summary or a section (the contact form; the officer's line is the one exception)",
    (locale) => {
      const p = getDictionary(locale).privacy;
      expect(JSON.stringify([p.body, p.sections])).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    },
  );

  it.each(LOCALES)("%s: no conformity claim", (locale) => {
    expect(allText(locale)).not.toMatch(/\bconformes?\b|\bcompliant\b|\bconformité\b|\bcompliance with\b/i);
  });
});
