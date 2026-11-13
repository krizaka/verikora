import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import consoleEn from "@/messages/console/en.json";
import consoleFr from "@/messages/console/fr.json";

import { DELETION_RULE } from "./deletion-receipt";
import { getDictionary } from "./i18n";
import { DECISION_RETENTION } from "./retention-policy";
import { defOf } from "./settings/registry";

/*
 * The privacy page says what the code does (krizaka-internal#3308): a document is purged once it is checked unless the person keeps
 * it, every purge leaves a signed receipt with no name, a kept document's place is the one the code allows, the places outside Québec
 * and the s. 17 assessment (a draft: « being prepared »), and no decision is made by a machine alone. Each sentence points at its code.
 */
const ROOT = join(__dirname, "..");
const LOCALES = ["en", "fr"] as const;
const CONSOLE = { en: consoleEn, fr: consoleFr } as const;

const sectionOf = (locale: (typeof LOCALES)[number], id: string) => {
  const s = getDictionary(locale).privacy.sections.find((x) => x.id === id);
  if (!s) throw new Error(`no section « ${id} » in ${locale}`);
  return `${s.h} ${s.p}`;
};
const allText = (locale: (typeof LOCALES)[number]) => JSON.stringify(getDictionary(locale).privacy);

describe("the privacy page says what the code does (krizaka-internal#3308)", () => {
  it.each(LOCALES)(
    "%s: no longer says a document is kept until it is deleted, nor that it is in New York",
    (locale) => {
      const all = allText(locale);
      expect(all).not.toMatch(/kept until you delete it|gardé jusqu.à ce que vous le supprimiez/i);
      expect(all).not.toMatch(/New York/i);
    },
  );

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
    ["en", /purged/i, /report stays/i, /keep/i],
    ["fr", /purgé/i, /rapport reste/i, /conserver/i],
  ] as const)(
    "%s: purge by default once a file is checked, the report stays, keeping is a choice",
    (locale, purged, report, keep) => {
      const s = sectionOf(locale, "retention");
      expect(s).toMatch(purged);
      expect(s).toMatch(report);
      expect(s).toMatch(keep);
    },
  );

  it.each([
    ["en", /24 hours/],
    ["fr", /24 heures/],
  ] as const)("%s: a never-checked file is purged after the setting's default window", (locale, window) => {
    // lib/settings/registry.ts: the default of « limits.purgeAfterHours » is the figure the page names
    expect(defOf("limits.purgeAfterHours").default).toBe(24);
    expect(sectionOf(locale, "retention")).toMatch(window);
  });

  it.each([
    ["en", /one year after the decision/i, /30 days/],
    ["fr", /un an après la décision/i, /30 jours/],
  ] as const)(
    "%s: an applicant file's classes — at the decision, or one year after it; a screening result 30 days",
    (locale, year, days) => {
      expect(DECISION_RETENTION.oneYear).toBe("one-year-after-decision");
      const s = sectionOf(locale, "applicant-files");
      expect(s).toMatch(year);
      expect(s).toMatch(days);
    },
  );

  it.each([
    ["en", /signed receipt/i, /no name/i],
    ["fr", /reçu signé/i, /aucun nom/i],
  ] as const)("%s: every purge leaves a signed receipt that holds no name", (locale, receipt, noName) => {
    expect(Object.values(DELETION_RULE)).toContain("after-check");
    const s = sectionOf(locale, "receipt");
    expect(s).toMatch(receipt);
    expect(s).toMatch(noName);
  });

  it.each([
    ["en", /Toronto/, /development/i, /fictional/i, /Canada/],
    ["fr", /Toronto/, /développement/i, /fictives/i, /Canada/],
  ] as const)(
    "%s: where a kept document lives — a development store for fictional data today, Canada in production",
    (locale, ...words) => {
      const s = sectionOf(locale, "where");
      for (const w of words) expect(s).toMatch(w);
      // the panel's own words for the development store (messages/console … storage.devOnly)
      expect(JSON.stringify(CONSOLE[locale])).toMatch(
        locale === "fr" ? /données fictives seulement/ : /fictional data only/,
      );
    },
  );

  it.each([
    ["en", /section 17/i, /being prepared/i, /Ontario/],
    ["fr", /article 17/i, /en préparation/i, /Ontario/],
  ] as const)(
    "%s: outside Québec — the places, and the s. 17 assessment is being prepared, never done",
    (locale, article, prepared, ontario) => {
      const s = sectionOf(locale, "outside-quebec");
      expect(s).toMatch(article);
      expect(s).toMatch(prepared);
      expect(s).toMatch(ontario);
      expect(allText(locale)).not.toMatch(
        /assessment (is )?(done|complete|completed|finished)|évaluation (est )?(faite|terminée|réalisée|complétée)/i,
      );
    },
  );

  it.each(LOCALES)("%s: no decision by a machine alone — the console's own sentence, and s. 12.1", (locale) => {
    const person = CONSOLE[locale].console.analysis.traces.notItems.person;
    const s = sectionOf(locale, "automated-decisions");
    expect(s).toContain(person);
    expect(s).toMatch(/12\.1/);
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
