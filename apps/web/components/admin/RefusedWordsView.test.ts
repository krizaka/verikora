import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ADMIN_GROUPS } from "@/lib/admin-nav";
import { CONFIG_PAGE, isConfigPage } from "@/lib/settings/admin-config";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const source = readFileSync(new URL("./RefusedWordsView.tsx", import.meta.url), "utf8");
const page = readFileSync(
  new URL("../../app/[locale]/(admin)/console/(signed)/config/[group]/page.tsx", import.meta.url),
  "utf8",
);
const at = (tree: unknown, path: string) =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);

describe("the refused-word screen of the administration (krizaka-internal#3378)", () => {
  it("is a page of the configuration, drawn by the config route", () => {
    expect(isConfigPage(CONFIG_PAGE.words)).toBe(true);
    expect(page).toContain("<RefusedWordsView />");
    expect(ADMIN_GROUPS.flatMap((g) => g.pages).some((p) => p.key === "config")).toBe(true);
  });
  it("lets the administrator add a word and remove one, through the audited API", () => {
    expect(source).toContain('"/api/admin/refused-words"');
    expect(source).toMatch(/method: "POST"/);
    expect(source).toMatch(/method: "DELETE"/);
    expect(source).toContain("<form.Form");
  });
  it("labels every control by the word it removes, in the list's language", () => {
    expect(source).toContain("adminConfig.words.removeWord");
  });
  it.each(["en", "fr"] as const)("has every key it uses, and the tab's name (%s)", (lang) => {
    const tree = (lang === "en" ? en : fr).console;
    const keys = [...source.matchAll(/say\(\s*"((?:adminConfig|errors)\.[A-Za-z.]+)"/g)].map((m) => m[1] as string);
    keys.push("adminConfig.groups.words", "errors.INVALID_WORD", "errors.ALREADY_LISTED", "errors.LIST_EMPTY");
    for (const l of ["fr", "en"]) {
      keys.push(`adminConfig.words.languages.${l}`, `adminConfig.words.listTitle.${l}`);
    }
    expect(keys.filter((k) => typeof at(tree, k) !== "string")).toEqual([]);
  });
});
