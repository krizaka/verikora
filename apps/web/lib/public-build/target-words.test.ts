import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One page, two truths (krizaka-internal#4148): the dev app has accounts, documents and an API; the public export has none of them.
 * The target chooses the words through the overlay alias of next.config.public.mjs, never an `if` in the page. These tests load the
 * dictionary under each target the way the build wires it.
 */
const LOCALES = ["en", "fr"] as const;
const ROOT = join(__dirname, "../..");

afterEach(() => {
  vi.doUnmock("@/lib/public-overlay");
  vi.resetModules();
});

async function dictionaryUnder(target: "dev" | "public", locale: (typeof LOCALES)[number]) {
  vi.resetModules();
  vi.doMock("@/lib/public-overlay", () =>
    target === "public" ? import("./overlay") : { publicOverlay: { en: {}, fr: {} } },
  );
  const { getDictionary } = await import("../i18n");
  return getDictionary(locale);
}

const privacyText = (t: Awaited<ReturnType<typeof dictionaryUnder>>) => JSON.stringify(t.privacy);
const docsText = (t: Awaited<ReturnType<typeof dictionaryUnder>>) =>
  JSON.stringify({ ...t.docs, api: undefined, sections: { check: t.docs.sections.check, data: t.docs.sections.data } });

describe("the dev target's privacy and docs", () => {
  it.each(LOCALES)("%s: the privacy page still names accounts, purges and storage", async (locale) => {
    const text = privacyText(await dictionaryUnder("dev", locale));
    expect(text).toMatch(locale === "fr" ? /compte/i : /account/i);
    expect(text).toMatch(locale === "fr" ? /purg/i : /purged/i);
    expect(text).toMatch(/Toronto/);
    expect(text).toMatch(/Stripe/);
  });

  it.each(LOCALES)("%s: the docs still speak of the API and of your account", async (locale) => {
    const t = await dictionaryUnder("dev", locale);
    expect(t.docs.lead).toMatch(/API/);
    expect(t.docs.data.intro).toMatch(locale === "fr" ? /votre compte/i : /your account/i);
  });
});

describe("the public target's privacy and docs", () => {
  it.each(LOCALES)("%s: no account, no document, the complaint path and the officer's address", async (locale) => {
    const t = await dictionaryUnder("public", locale);
    const text = privacyText(t);
    expect(t.privacy.body).toMatch(locale === "fr" ? /pas de compte/i : /no account/i);
    expect(text).not.toMatch(
      /Toronto|United States|États-Unis|development store|stockage de développement|purg|receipt|reçu|Stripe|Mailgun/i,
    );
    expect(t.privacy.sections.find((s) => s.id === "complaints")?.p).toMatch(/Commission d.accès à l.information/);
    // the role address is rendered by the page from the one constant, whatever the words
    expect(readFileSync(join(ROOT, "app/[locale]/privacy/page.tsx"), "utf8")).toContain("PRIVACY_OFFICER_EMAIL");
    expect(readFileSync(join(ROOT, "lib/privacy-officer.ts"), "utf8")).toMatch(/PRIVACY_OFFICER_EMAIL\s*=\s*"[^"]+@/);
  });

  it.each(LOCALES)("%s: the docs say nothing of the API, of keys or of an account", async (locale) => {
    const text = docsText(await dictionaryUnder("public", locale));
    expect(text).not.toMatch(/\bAPI\b|votre compte|your account|closing your account|fermer votre compte|webhook/i);
  });

  it.each(LOCALES)("%s: the docs keep every entry the overlay does not change", async (locale) => {
    const t = await dictionaryUnder("public", locale);
    expect(t.docs.check.levels).toContain("{observed}");
    expect(t.docs.check.finding.length).toBeGreaterThan(0);
  });

  it("keeps the same anchors in both languages", async () => {
    const ids = async (locale: (typeof LOCALES)[number]) =>
      (await dictionaryUnder("public", locale)).privacy.sections.map((s) => s.id);
    expect(await ids("fr")).toEqual(await ids("en"));
  });
});
