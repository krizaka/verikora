import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HERO } from "@/content/recorded-runs/samples.mjs";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { verdictOf } from "./document-face";
import { HERO_FIGURES, heroFinding } from "./landing";
import { recordedRun } from "./recorded-runs";
import { ruleTitle } from "./rule-text";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const words = (o: unknown): string[] =>
  typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(words) : [];

describe("the home is the product page template, built from data (krizaka-internal#4692, #4634)", () => {
  const home = read("app/[locale]/page.tsx");
  const data = read("lib/product-page-data.ts");

  it("draws ProductPage and holds no words and no address: the way in is the contact form of krizaka.com (the org's builder), « Se connecter » is not the hero's action", () => {
    expect(home).toMatch(/<ProductPage\b/);
    expect(home).toContain('contactHref(source, locale, "business")');
    expect(home).not.toMatch(/https?:\/\//);
    expect(data).toContain('links.demo("verikora-home-hero")');
    expect(data).toContain('links.demo("verikora-home-closing")');
    expect(`${home}${data}`).not.toMatch(/HeroActions|signIn\b/);
  });

  it("has the two sections the menu points to, in this order, and links the hero to the proof", () => {
    expect(data.indexOf('id: "what"')).toBeGreaterThan(data.indexOf('id: "proof"'));
    expect(home).toContain('sample: "#proof"');
  });

  it("keeps the template's quiet register: no counter, no glow, no drawn frame, the status after the page", () => {
    expect(home).not.toMatch(/NumberTicker|GlowCard|Sparkle|shimmer|DeviceFrame|LandingPage/);
    expect(home).toContain('<main id="content" data-landing>');
    expect(home).toContain('data-testid="hero-status"');
  });
});

describe("plain words, in both languages", () => {
  for (const [name, d] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    const copy = words([d.landing, d.productPage, d.meta, d.chrome, d.privacy, d.console.signIn]);
    it(`${name}: no em dash, no « AI-powered » hype in the public copy`, () => {
      expect(copy.filter((w) => /—/.test(w))).toEqual([]);
      expect(
        copy.filter((w) =>
          /ai-powered|powered by ai|alimenté par l'ia|propulsé par l'ia|magique|magic|révolution|revolution/i.test(w),
        ),
      ).toEqual([]);
    });
    it(`${name}: Verikora is the subject; Sovkora, the engine, is not named on the home`, () => {
      expect(words([d.landing, d.productPage]).filter((w) => /sovkora/i.test(w))).toEqual([]);
    });
    it(`${name}: the app says Checks, with the engine in small print`, () => {
      expect(d.console.document.checks).not.toMatch(/Sovkora/);
      expect(d.console.document.checksLead).toMatch(/Sovkora/);
    });
  }
});

describe("the proof is read from the recording, never typed", () => {
  it("the finding and the figures are counted from the recorded run", () => {
    const run = recordedRun("tenant");
    expect(read("lib/product-page-data.ts")).toContain("heroFinding()");
    const figures = HERO_FIGURES(run.report);
    expect(figures.rules).toBe(run.report.summary?.rulesEvaluated);
    expect(figures.found).toBe(run.report.findings.length);
  });

  it("counts the distinct articles a finding cites, however the citation lists them", () => {
    expect(
      HERO_FIGURES({
        findings: [
          { citation: "C.c.Q., art. 1855 et 1903 ; Règlement, section D" },
          { citation: "C.c.Q., art. 1904, al. 1" },
          { citation: "C.c.Q., art. 1904, al. 2" },
          { citation: null },
        ],
      }),
    ).toEqual({ rules: 4, articles: 3, found: 4 });
  });
});

/** What the recording says about a rule, raw: the schema the app reads drops `checks`, the engine's proof the quote was found in the file. */
function rawFinding(side: "tenant" | "landlord", ruleId: string) {
  const file = JSON.parse(read(`content/recorded-runs/${side}.json`)) as {
    run: { outputs: Record<string, { value?: unknown }> };
  };
  for (const out of Object.values(file.run.outputs)) {
    if (typeof out.value !== "string") {
      continue;
    }
    const report = JSON.parse(out.value) as { findings?: { ruleId: string; checks?: { passage?: string } }[] };
    const found = report.findings?.find((f) => f.ruleId === ruleId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("the hero's finding is chosen by data, and by a rule", () => {
  const finding = heroFinding();

  it("is a finding of the recorded run the data names, failed, with a verified quote and an article", () => {
    expect(recordedRun(HERO.run).report.findings).toContain(finding);
    expect(finding.verdict).toBe("FAIL");
    expect(finding.evidenceSpan?.quote).toBeTruthy();
    expect(rawFinding(HERO.run, HERO.rule)?.checks?.passage).toBe("VERIFIED");
    expect(finding.citation).toMatch(/art\. \d+/);
  });

  it("is never the worn security-deposit example (QC-LEASE-004)", () => {
    expect(HERO.rule).not.toBe("QC-LEASE-004");
    expect(finding.ruleId).not.toBe("QC-LEASE-004");
  });

  it("is typed nowhere in the home's data or page", () => {
    expect(read("lib/product-page-data.ts")).not.toMatch(/QC-[A-Z]+-\d+/);
    expect(read("app/[locale]/page.tsx")).not.toMatch(/QC-[A-Z]+-\d+/);
  });

  it("shows its title in the page's language, from the rule catalogue: an /en render never shows the French one", () => {
    expect(finding.title).toBeTruthy();
    const en = ruleTitle(finding.ruleId, "en", finding.title);
    const fr = ruleTitle(finding.ruleId, "fr", finding.title);
    expect(en).not.toBe(finding.title);
    expect(en).not.toBe(fr);
    expect(fr).toBe(finding.title);
    expect(read("lib/product-page-data.ts")).toContain("ruleTitle(finding.ruleId, locale, finding.title)");
    expect(read("lib/product-page-data.ts")).not.toMatch(/\{finding\.title/);
  });
});

describe("the recorded report the home reads from, its figures read from the run", () => {
  const run = recordedRun(HERO.run);
  const report = run.report;

  it("shows every finding of the run it names: nothing is filtered, and the figures are the run's own", () => {
    expect(read("lib/product-page-data.ts")).not.toMatch(/homeReport|HOME_HIDDEN/);
    expect(report.summary?.rulesEvaluated).toBe(report.findings.length);
    expect(Object.values(report.summary?.byVerdict ?? {}).reduce((a, b) => a + b, 0)).toBe(report.findings.length);
    expect(verdictOf(report).attention).toBe(
      report.findings.filter((f) => f.verdict === "FAIL" || f.verdict === "INSUFFICIENT_EVIDENCE").length,
    );
    expect(verdictOf(report).blocking).toBe(
      report.findings.filter((f) => f.verdict === "FAIL" && f.severity === "BLOCKING").length,
    );
  });

  it("names no run that holds a security-deposit finding: QC-LEASE-004 is neither failed nor passed in the home's run (its lease has no deposit clause)", () => {
    expect(run.document.text).not.toMatch(/d[ée]p[ôo]t/i);
    expect(report.findings.find((f) => f.ruleId === "QC-LEASE-004")?.verdict).toBe("NOT_APPLICABLE");
  });

  it("types no count in the page's messages: no digit followed by rules, findings or articles, in either language", () => {
    for (const d of [en, fr]) {
      expect(
        words([d.landing, d.productPage]).filter((w) =>
          /\d+\s*(rules?|règles?|findings?|constats?|articles?)/i.test(w),
        ),
      ).toEqual([]);
    }
  });
});
