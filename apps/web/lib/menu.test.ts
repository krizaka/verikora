import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import config from "../next.config.mjs";
import { DOWNLOADS, downloadsOffered } from "./downloads";
import { HOME_ANCHORS, MENU, menuHref, signInPath } from "./nav";
import { ALIAS_RULES, OLD_AUDIENCE_SLUGS, PARKED_PAGES, redirectRules } from "./removed-urls.mjs";
import { pagePath, PAGES } from "./site";

/**
 * Simplify Yomizaka (krizaka/yomizaka#120): the public site is the home, sign-in and the privacy notice. Every item of the
 * menu resolves to a page or an anchor that exists, and every address that was removed answers 308 to its new home.
 */
const ROOT = join(__dirname, "..");
const pageFile = (page: string) => join(ROOT, "app/[locale]", page === "home" ? "" : page, "page.tsx");

describe("every menu item resolves", () => {
  it("each item leads to a page that exists, in both languages", () => {
    for (const item of MENU) {
      expect(PAGES, item.id).toContain(item.page);
      expect(existsSync(pageFile(item.page)), item.id).toBe(true);
      for (const locale of ["en", "fr"] as const) expect(menuHref(locale, item).startsWith(`/${locale}`)).toBe(true);
    }
  });

  it("each anchor is a section id of the home", () => {
    const home = readFileSync(pageFile("home"), "utf8");
    expect(HOME_ANCHORS.length).toBeGreaterThan(0);
    for (const anchor of HOME_ANCHORS) expect(home, anchor).toContain(`id="${anchor}"`);
  });

  it("sign-in exists and is the bar's action; the menu stays short", () => {
    expect(existsSync(join(ROOT, "app/[locale]/(app)/sign-in/page.tsx"))).toBe(true);
    expect(signInPath("fr")).toBe("/fr/sign-in");
    expect(MENU.length).toBeLessThanOrEqual(5);
  });

  it("every public page is reachable from the bar (the terms and the downloads from the footer): the home by the mark, the others by the menu or the action", () => {
    const reachable = new Set<string>(["home", ...MENU.map((m) => m.page)]);
    for (const page of PAGES.filter((p) => p !== "terms" && p !== "download")) expect(reachable.has(page), page).toBe(true);
    expect(pagePath("en", "home")).toBe("/en");
  });

  it("the labels exist in both languages", async () => {
    const en = (await import("@/messages/en.json")).default;
    const fr = (await import("@/messages/fr.json")).default;
    for (const item of MENU) {
      expect(en.chrome.nav[item.id]).toBeTruthy();
      expect(fr.chrome.nav[item.id]).toBeTruthy();
    }
  });
});

/** The signed-in space's renamed addresses (yomizaka#389), as opposed to the public pages that went to the home. */
const isAppRule = (r: { source: string; destination: string }) => /\/app(\/|$)/.test(r.destination);

/** Whether a path (without its language) is served by a page file of app/[locale]: groups ignored, `[param]` matches any segment. */
function pageExists(path: string): boolean {
  const walk = (dir: string, segments: string[]): boolean => {
    if (segments.length === 0) return existsSync(join(dir, "page.tsx"));
    const [head, ...rest] = segments;
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const entry of entries) {
      if (/^\(.+\)$/.test(entry.name)) {
        if (walk(join(dir, entry.name), segments)) return true;
      } else if ((entry.name === head || /^\[[^.].*\]$/.test(entry.name)) && walk(join(dir, entry.name), rest)) return true;
    }
    return false;
  };
  return walk(join(ROOT, "app/[locale]"), path.split("/").filter(Boolean));
}

/** What Next does with `redirects()`: the first rule whose source matches (`:path*` is the rest of the address). */
function resolve(path: string): string | null {
  for (const rule of redirectRules()) {
    const match = new RegExp(`^${rule.source.replace(/\/:path\*$/, "(?:/(.*))?").replace(/\/:path\+$/, "/(.+)")}$`).exec(path);
    if (match) return rule.destination.replace(/:path[*+]/, match[1] ?? "").replace(/\/$/, "") || "/";
  }
  return null;
}

describe("every removed address redirects (308) to its new home", () => {
  const rules = redirectRules();
  const redirects = (config as { redirects: () => Promise<{ source: string; destination: string; permanent: boolean }[]> }).redirects;

  it("next.config serves exactly these rules, all permanent (308)", async () => {
    expect(await redirects()).toEqual([...rules, ...ALIAS_RULES]);
    for (const rule of rules) expect(rule.permanent).toBe(true);
  });

  it("covers the run page, the changelog (and its feed) and the eight audience pages, with and without a language", () => {
    const sources = new Set(rules.map((r) => r.source));
    for (const path of ["/run", "/changelog", "/changelog/feed.xml", ...OLD_AUDIENCE_SLUGS.map((s) => `/${s}`)]) {
      for (const prefix of ["/en", "/fr", ""]) expect(sources.has(`${prefix}${path}`), `${prefix}${path}`).toBe(true);
    }
  });

  it("leads each removed public page to the home of its language, or to the proof for the run page", () => {
    for (const rule of rules.filter((r) => !isAppRule(r))) {
      const locale = rule.source.match(/^\/(en|fr)\//)?.[1];
      const target = rule.source.endsWith("/run") ? "#proof" : "";
      expect(rule.destination).toBe(locale ? `/${locale}${target}` : `/${target}`);
    }
  });

  it("no page file is left behind a removed address", () => {
    for (const dir of ["run", "changelog", "[side]", "tenant", "landlord", "locataire", "verify"]) expect(existsSync(join(ROOT, "app/[locale]", dir)), dir).toBe(false);
    for (const dir of ["recherche", "verifier", "bibliotheque", "bienvenue"]) expect(existsSync(join(ROOT, "app/[locale]/(app)/app", dir)), dir).toBe(false);
  });

  it("every moved address answers 308 to a page that exists (yomizaka#389)", () => {
    const moved = rules.filter(isAppRule);
    expect(moved.length).toBeGreaterThan(0);
    for (const rule of moved) {
      expect(rule.permanent).toBe(true);
      const target = rule.destination.replace(/^\/(en|fr)(?=\/)/, "").replace(/:path[*+]/, "x");
      expect(pageExists(target), `${rule.source} -> ${rule.destination}`).toBe(true);
    }
  });

  it("each old French address lands on its English one, first matching rule, with and without the language", () => {
    const table: [string, string][] = [
      ["/verify", "/app/verifications/report"],
      ["/app/recherche", "/app/search"],
      ["/app/bienvenue", "/app/welcome"],
      ["/app/verifier", "/app/check"],
      ["/app/verifier/lots", "/app/check/batches"],
      ["/app/verifier/lots/b1", "/app/check/batches/b1"],
      ["/app/bibliotheque", "/app"],
      ["/app/bibliotheque/sans-collection", "/app"],
      ["/app/bibliotheque/l1/c1/f1", "/app/library/l1/c1/f1"],
    ];
    for (const [from, to] of table) {
      for (const prefix of ["/en", "/fr", ""]) expect(resolve(`${prefix}${from}`), `${prefix}${from}`).toBe(`${prefix}${to}`);
    }
  });

  it("/download is parked while no app can be downloaded: 308 to the home, out of the footer and the sitemap; it comes back with the first link", async () => {
    const parked = PARKED_PAGES.includes("/download");
    expect(parked).toBe(!downloadsOffered());
    expect(DOWNLOADS.every((d) => d.href === null)).toBe(parked);
    for (const prefix of ["/en", "/fr"]) expect(rules).toContainEqual({ source: `${prefix}/download`, destination: prefix, permanent: true });
    const { default: sitemap } = await import("../app/sitemap");
    expect(sitemap().filter((e) => e.url.includes("/download"))).toEqual([]);
    expect(readFileSync(join(ROOT, "components/SiteFooter.tsx"), "utf8")).toContain('isListed("download")');
  });

  it("the report checker moved into the app: /verify answers 308 to /app/verifications/report, which exists and is no longer public", () => {
    expect(rules).toContainEqual({ source: "/fr/verify", destination: "/fr/app/verifications/report", permanent: true });
    expect(existsSync(join(ROOT, "app/[locale]/(app)/app/verifications/report/page.tsx"))).toBe(true);
  });

  it("no destination is itself removed (no chain)", () => {
    const sources = new Set(rules.map((r) => r.source));
    for (const rule of rules) expect(sources.has(rule.destination.split("#")[0]), rule.destination).toBe(false);
  });
});
