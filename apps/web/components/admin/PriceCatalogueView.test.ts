import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const source = readFileSync(new URL("./PriceCatalogueView.tsx", import.meta.url), "utf8");
const at = (tree: unknown, path: string) =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);

describe("the price editor's words (verikora#548)", () => {
  // Every literal key the screen asks for exists in both languages (the dynamic ones, `units.<id>`, are checked below).
  const keys = [...source.matchAll(/say\(\s*"((?:adminConfig|errors)\.[A-Za-z.]+)"/g)].map((m) => m[1] as string);
  it.each(["en", "fr"] as const)("has every key it uses (%s)", (lang) => {
    const tree = (lang === "en" ? en : fr).console;
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((k) => typeof at(tree, k) !== "string")).toEqual([]);
  });

  it.each(["en", "fr"] as const)(
    "words every unit, availability, limit and sync status the API can send (%s)",
    (lang) => {
      const prices = (lang === "en" ? en : fr).console.adminConfig.prices;
      for (const k of ["month", "year", "once", "document", "order", "pack", "hour"])
        expect(prices.units[k as keyof typeof prices.units]).toBeTruthy();
      for (const k of ["public", "internal", "founder-limited", "preparing"])
        expect(prices.availabilities[k as keyof typeof prices.availabilities]).toBeTruthy();
      for (const k of ["included", "founderCap", "feeBps", "feeCapCents"])
        expect(prices.limits[k as keyof typeof prices.limits]).toBeTruthy();
      for (const k of ["exists", "created", "repriced"])
        expect(prices.sync.status[k as keyof typeof prices.sync.status]).toBeTruthy();
    },
  );

  it("asks for a confirmation before any change, and never edits a live processor", () => {
    expect(source).toContain("AlertDialog");
    expect(source).toContain("settle(true)");
    expect(source).toMatch(/processor\.mode === "live" \? \(\s*<Alert/);
  });
});
