import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/messages/site/en.json";
import fr from "@/messages/site/fr.json";

import {
  clauseLines,
  leaseLines,
  overBudget,
  pageWords,
  parseTemplate,
  PRODUCT_PAGE,
  recordedClauseLines,
  sceneMedia,
} from "./product-page";

const WORDS = { en: en.productPage, fr: fr.productPage } as const;

describe("product page template (krizaka-internal#4692)", () => {
  it("shows the scenes the media registry lists for its role, each with a recording", () => {
    const scenes = sceneMedia("fr");
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    for (const s of scenes) {
      expect(s.poster).toMatch(/^https:/);
      expect(s.webm || s.mp4).toBeTruthy();
    }
  });

  it("has words for every scene it can show, in both languages", () => {
    for (const locale of ["en", "fr"] as const) {
      const scenes: Record<string, unknown> = WORDS[locale].scenes;
      for (const s of sceneMedia(locale)) {
        expect(scenes[s.id], `${locale}:${s.id}`).toBeDefined();
      }
    }
  });

  it("keeps every section within its text budget", () => {
    expect(overBudget(WORDS.fr, PRODUCT_PAGE.budget)).toEqual([]);
    expect(overBudget(WORDS.en, PRODUCT_PAGE.budget)).toEqual([]);
  });

  it("names a section that goes over its budget", () => {
    const long = { ...WORDS.fr, hero: { ...WORDS.fr.hero, title: "un deux trois quatre cinq six sept huit neuf dix" } };
    expect(overBudget(long, PRODUCT_PAGE.budget)).toContain("hero.title");
  });

  it("flags the one lease line that holds the quoted clause", () => {
    const lines = leaseLines("Ligne une.\nLe locataire renonce à son droit.\nLigne trois.", "renonce à son droit");
    expect(lines.filter((l) => l.flagged).map((l) => l.text)).toEqual(["Le locataire renonce à son droit."]);
  });

  it("types no product name where the page is built: the template draws, the data says", () => {
    const files = [join(__dirname, "product-page-data.ts"), join(__dirname, "..", "app", "[locale]", "page.tsx")];
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/Verikora|Sovkora|Folioviv/);
    }
  });
});

describe("product page story and micro-demo (krizaka-internal#4692, iteration 2)", () => {
  it("tells one journey in five steps, in the template's order, each with words in both languages", () => {
    expect(PRODUCT_PAGE.story.steps).toEqual(["arrive", "read", "light", "attach", "decide"]);
    for (const locale of ["en", "fr"] as const) {
      for (const step of PRODUCT_PAGE.story.steps) {
        expect(WORDS[locale].story.steps[step]?.title, `${locale}:${step}`).toBeTruthy();
      }
    }
  });

  it("refuses a story step the stage cannot draw", () => {
    expect(() =>
      parseTemplate({ ...PRODUCT_PAGE, story: { ...PRODUCT_PAGE.story, steps: ["arrive", "dance"] } }),
    ).toThrow();
  });

  it("attaches each lease line to the finding that quotes it, a failed point before a respected one, the most precise quote first", () => {
    const findings = [
      { ruleId: "LANG", verdict: "PASS", quote: "locatrice", citation: "art. 55" },
      { ruleId: "ID", verdict: "PASS", quote: "locatrice Madame", citation: "art. 1895" },
      { ruleId: "WAIVE", verdict: "FAIL", quote: "renonce à son droit", citation: "art. 1936" },
      { ruleId: "NONE", verdict: "FAIL", quote: null, citation: "art. 1896" },
    ];
    const lines = clauseLines("Titre.\nEntre la locatrice Madame Roy.\nLe locataire renonce à son droit.", findings);
    expect(lines.map((l) => l.finding?.ruleId ?? null)).toEqual([null, "ID", "WAIVE"]);
  });

  it("opens the micro-demo on the recorded run's failed clause, with its article", () => {
    const lines = recordedClauseLines();
    const failed = lines.filter((l) => l.finding?.verdict === "FAIL");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.finding?.citation).toMatch(/art\./);
    expect(lines.filter((l) => l.finding).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the whole page near ninety words", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(pageWords(WORDS[locale]), locale).toBeLessThanOrEqual(110);
    }
  });
});
