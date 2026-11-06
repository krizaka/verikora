// The journey catalogue (ADR-017, krizaka/.github#423): every journey file has a row, every row a file, every row is a good
// journey of a persona of the seeded cast, none is over its budget on paper, and no Playwright config retries.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { castOf } from "@krizaka/org";
import { assertNoRetries, budgetProblem, checkCatalogue, validateJourney } from "@krizaka/page-audit/journey";

const DIR = new URL("../apps/web/e2e/journeys/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("journeys.json", DIR), "utf8"));
const files = readdirSync(DIR);
const cast = castOf("verikora").map((p) => p.id);

describe("the journey catalogue of Verikora", () => {
  it("has a row for every journey file and a file for every row", () => {
    expect(checkCatalogue({ files, index })).toEqual([]);
  });
  it("lists good journeys of the seeded cast", () => {
    for (const row of index) expect(validateJourney(row, { cast })).toEqual([]);
  });
  it("runs a smoke journey on every pull request", () => {
    expect(index.some((j) => j.tags?.includes("smoke"))).toBe(true);
  });
  it("states a budget the kit can judge", () => {
    for (const row of index) expect(budgetProblem(row, 1000)).toBeUndefined();
  });
  it("never retries a journey (a flake is a bug)", async () => {
    const { default: config } = await import("../apps/web/e2e/journeys/playwright.config.mjs");
    expect(() => assertNoRetries(config)).not.toThrow();
  });
});
