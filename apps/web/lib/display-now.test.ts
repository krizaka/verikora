import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { displayNow } from "./display-now";
import { productionProblems, readEnv } from "./env";

const REAL = new Date("2026-11-02T08:00:00Z");
const FROZEN = "2026-10-30T12:00:00Z";
const fromRoot = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("displayNow", () => {
  it("is the real instant when nothing froze it", () => {
    expect(displayNow(REAL, "dev", undefined)).toBe(REAL);
  });
  it("is the frozen instant in a dev run", () => {
    expect(displayNow(REAL, "dev", FROZEN).toISOString()).toBe("2026-10-30T12:00:00.000Z");
  });
  it("never freezes production: the real instant, and the setting is a startup problem", () => {
    const prod = { APP_ENVIRONMENT: "prod", APP_VISUAL_NOW: FROZEN };
    expect(displayNow(REAL, "prod", FROZEN)).toBe(REAL);
    expect(productionProblems(readEnv({ ...prod, NODE_ENV: "production" })).join()).toMatch(/APP_VISUAL_NOW/);
  });
});

describe("the visual runs have one date", () => {
  it("the start script freezes the date the baselines were drawn on", () => {
    expect(fromRoot("scripts/ci-visual-start.sh")).toMatch(/^export APP_VISUAL_NOW=2026-10-30T12:00:00Z$/m);
  });
  it("every page that writes « today » passes it through displayNow", () => {
    // check/page.tsx no longer shows the date (Today removed, krizaka-internal#2292)
    for (const page of [] as string[]) {
      expect(readFileSync(new URL(`../${page}`, import.meta.url), "utf8"), page).toContain(
        "now={displayNow(now, appEnvironment(), appVisualNow()).toISOString()}",
      );
    }
  });
  it("no journey pins a date by hand, nor reads a clock", () => {
    expect(fromRoot("apps/web/e2e/visual/journeys.visual.mjs")).not.toMatch(
      /PINNED_|textContent\s*=|new Date\(|Date\.now\(/,
    );
  });
});
