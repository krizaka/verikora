import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { CLOSED_ROBOTS, indexableOn, isCodeNameHost, metaRobots, NOINDEX_HEADER } from "./indexing";
import { SITE_URL } from "./site";

afterEach(() => vi.unstubAllEnvs());

const ask = async (path: string, host = "www.yomizaka.com") => {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
};

/** Wave 1 (meeting 2026-11-05): www.yomizaka.com is the code-name address; the public one is www.verikora.com. */
describe("the code-name host is noindex, whatever the flag", () => {
  it("knows a code-name host", () => {
    for (const host of ["www.yomizaka.com", "yomizaka.com", "dev.yomizaka.com", "WWW.yomizaka.com:443"])
      expect(isCodeNameHost(host), host).toBe(true);
    expect(isCodeNameHost("www.verikora.com")).toBe(false);
    expect(isCodeNameHost("notyomizaka.com")).toBe(false);
  });

  it("is never indexable, even as the public host with the flag on; the commercial domain is", () => {
    expect(indexableOn("www.yomizaka.com", { APP_SEARCH_INDEXING: "on" })).toBe(false);
    expect(
      indexableOn("www.yomizaka.com", { APP_SEARCH_INDEXING: "on", APP_PUBLIC_URL: "https://www.yomizaka.com" }),
    ).toBe(false);
    expect(
      indexableOn("www.verikora.com", { APP_SEARCH_INDEXING: "on", APP_PUBLIC_URL: "https://www.verikora.com" }),
    ).toBe(true);
  });

  it("every response says X-Robots-Tag noindex; robots.txt is Disallow: / with no sitemap; sitemap.xml is 404", async () => {
    vi.stubEnv("APP_SEARCH_INDEXING", "on");
    for (const path of ["/fr", "/en", "/fr/pricing", "/fr/contact", "/fr/sign-in"])
      expect((await ask(path)).headers.get("x-robots-tag"), path).toBe(NOINDEX_HEADER);
    const txt = await ask("/robots.txt");
    expect(await txt.text()).toBe(CLOSED_ROBOTS);
    expect(txt.headers.get("x-robots-tag")).toBe(NOINDEX_HEADER);
    expect((await ask("/sitemap.xml")).status).toBe(404);
  });

  it("the page says it too: <meta name=robots> noindex, and the generated robots file closes everything without a sitemap", () => {
    expect(metaRobots(SITE_URL, { APP_SEARCH_INDEXING: "on" })).toEqual({ index: false, follow: false });
    expect(metaRobots("https://www.verikora.com", { APP_SEARCH_INDEXING: "on" })).toBeUndefined();
    const file = robots();
    expect(file.sitemap).toBeUndefined();
    expect(file.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(readFileSync(join(import.meta.dirname, "../app/[locale]/layout.tsx"), "utf8")).toContain(
      "robots: metaRobots(SITE_URL)",
    );
  });
});

/** The public pages' words: no price, no promise of what is not built, no code name. */
const PUBLIC = ["meta", "landing", "privacy", "terms", "download", "docs", "contact", "stage"] as const;
const strings = (value: unknown, path: string[] = []): [string, string][] => {
  if (typeof value === "string") return [[path.join("."), value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, [...path, String(i)]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, [...path, k]));
  return [];
};
const publicWords = (dict: Record<string, unknown>) => PUBLIC.flatMap((section) => strings(dict[section], [section]));
const MONEY = /\d[\d\s.,]*\s?(\$|CAD|USD|€|dollars?)|\$\s?\d/iu;

describe("the public pages' messages", () => {
  for (const [name, dict] of [
    ["fr", fr],
    ["en", en],
  ] as const) {
    it(`${name}: no money amount (no 9,99, 49 or 149 $), no price of any kind`, () => {
      expect(publicWords(dict as Record<string, unknown>).filter(([, text]) => MONEY.test(text))).toEqual([]);
    });

    it(`${name}: no promise of what is not built (credit report, payment history, a free first check)`, () => {
      const promise =
        /rapport de cr[ée]dit|historique de paiement|credit report|payment history|premi[èe]re v[ée]rification (est )?offerte|first (check|verification|audit) is free|free first/iu;
      expect(publicWords(dict as Record<string, unknown>).filter(([, text]) => promise.test(text))).toEqual([]);
    });

    it(`${name}: the lead is plain words, not « extraction matrices and technical templates »`, () => {
      expect(dict.landing.lead).not.toMatch(/matrices|gabarits|templates/iu);
      expect(dict.landing.lead).toMatch(/Verikora/);
    });

    it(`${name}: no code name in the public words`, () => {
      expect(
        publicWords(dict as Record<string, unknown>).filter(
          ([key, text]) => key !== "stage.codeName" && /yomizaka/iu.test(text),
        ),
      ).toEqual([]);
    });
  }
});
