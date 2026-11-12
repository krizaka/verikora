import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HERO } from "@/content/recorded-runs/samples.mjs";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { verdictOf } from "./document-face";
import { type DevPreview, HERO_FIGURES, heroFinding, productStatus } from "./landing";
import { recordedRun } from "./recorded-runs";
import { ruleTitle } from "./rule-text";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const words = (o: unknown): string[] =>
  typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(words) : [];

describe("the home is one short page: who it is for, one real check, one way in", () => {
  const home = read("app/[locale]/page.tsx");

  it("has the two sections the menu points to, in this order; the hero's one primary and the closing's are the contact form of krizaka.com (the org's builder, never a typed address), « Se connecter » is not the hero's action", () => {
    expect(home.indexOf('id="what"')).toBeGreaterThan(0);
    expect(home.indexOf('id="proof"')).toBeGreaterThan(home.indexOf('id="what"'));
    expect(home.match(/variant="primary"/g) ?? []).toHaveLength(2);
    expect(home).toContain('contactHref("verikora-home-hero", locale, "business")');
    expect(home).toContain('contactHref("verikora-home-closing", locale, "business")');
    expect(home).not.toMatch(/https?:\/\//);
    expect(home).toContain('href="#proof"');
    expect(home).not.toMatch(/HeroActions|signIn\b/);
  });

  it("is the landing block with the product's answer beside the words (Y9): the recorded check in a browser frame, the three things as a bento, no repeated owl quote; no figures row under the hero (P10); no counter, no glow, no grid, no void above the hero", () => {
    expect(home).toMatch(/<LandingPage\b/);
    expect(home).toContain('data-testid="home-visual"');
    expect(home).not.toMatch(/DeviceFrame/);
    expect(home.match(/<HeroFinding\b/g) ?? []).toHaveLength(1);
    // A plain closing (a section), not the landing's coloured panel.
    expect(home).not.toMatch(/closing=\{/);
    expect(home).not.toContain("proofs=");
    expect(home.match(/<MascotQuote\b/g) ?? []).toHaveLength(0);
    // No decorative grid, counter or glow; the `CardGrid` block (card-grid) is the card layout itself, not a backdrop.
    expect(home).not.toMatch(/NumberTicker|GlowCard|Sparkle|shimmer|(?<!card-)grid\b/);
    expect(home).not.toContain("pt-20");
    expect(home).toContain('<main id="content" data-landing>');
    // LandingPage's hero frame pads itself with --kz-hero-top: nothing added on main (the offset would double).
    expect(read("app/globals.css")).not.toMatch(/main\[data-landing\] \{\s*padding-top/);
    expect(read("components/SiteChrome.tsx")).toContain("data-site-bar");
    for (const page of ["privacy", "terms", "download"])
      expect(read(`app/[locale]/${page}/page.tsx`), page).not.toContain("pt-20");
    expect(read("app/globals.css")).toContain("--kz-hero-top: 5.75rem");
  });

  it("says its honest status, read from dev-preview.json: in development while a criterion still has a gap", () => {
    const preview = JSON.parse(read("../../dev-preview.json")) as DevPreview;
    const gaps = Object.values(preview.criteria).some((c) => typeof c.evidence !== "string" && !c.na);
    expect(productStatus(preview)).toBe(gaps ? "development" : "preview");
    expect(en.landing.status[productStatus(preview)]).toBeTruthy();
  });

  it("counts a criterion that does not apply (na, with its reason) as met, and a bare null as a gap", () => {
    const met = { a: { evidence: "https://example.com/e" }, b: { na: "No mobile app for the Dev preview." } };
    expect(productStatus({ criteria: met })).toBe("preview");
    expect(productStatus({ criteria: { ...met, c: { evidence: null } } })).toBe("development");
  });
});

describe("plain words, in both languages", () => {
  for (const [name, d] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    const copy = words([d.landing, d.meta, d.chrome, d.privacy, d.console.signIn]);
    it(`${name}: no em dash, no « AI-powered » hype in the public copy`, () => {
      expect(copy.filter((w) => /—/.test(w))).toEqual([]);
      expect(
        copy.filter((w) =>
          /ai-powered|powered by ai|alimenté par l'ia|propulsé par l'ia|magique|magic|révolution|revolution/i.test(w),
        ),
      ).toEqual([]);
    });
    it(`${name}: Verikora is the subject; Sovkora, the engine, is named once on the home, in the quiet line under the proof`, () => {
      expect(words(d.landing).filter((w) => /sovkora/i.test(w))).toEqual([d.landing.proof.powered]);
      expect(d.landing.proof.powered).toMatch(/^(Powered by|Propulsé par) Sovkora\.$/);
    });
    it(`${name}: the app says Checks, with the engine in small print`, () => {
      expect(d.console.document.checks).not.toMatch(/Sovkora/);
      expect(d.console.document.checksLead).toMatch(/Sovkora/);
    });
  }
  it("the home shows the engine line", () => {
    expect(read("app/[locale]/page.tsx")).toContain("d.proof.powered");
  });
});

describe("the proof is read from the recording, never typed", () => {
  it("the finding and the figures are counted from the recorded run", () => {
    const run = recordedRun("tenant");
    expect(read("components/home/HeroFinding.tsx")).toContain("heroFinding()");
    const figures = HERO_FIGURES(run.report);
    expect(figures.rules).toBe(run.report.summary?.rulesEvaluated);
    expect(figures.found).toBe(run.report.findings.length);
    expect(read("app/[locale]/page.tsx")).toContain("report={run.report}");
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

  it("is typed nowhere in the home's components", () => {
    expect(read("components/home/HeroFinding.tsx")).not.toMatch(/QC-[A-Z]+-\d+/);
    expect(read("app/[locale]/page.tsx")).not.toMatch(/QC-[A-Z]+-\d+/);
  });

  it("shows its title in the page's language, from the rule catalogue: an /en render never shows the French one", () => {
    expect(finding.title).toBeTruthy();
    const en = ruleTitle(finding.ruleId, "en", finding.title);
    const fr = ruleTitle(finding.ruleId, "fr", finding.title);
    expect(en).not.toBe(finding.title);
    expect(en).not.toBe(fr);
    expect(fr).toBe(finding.title);
    expect(read("components/home/HeroFinding.tsx")).toContain("ruleTitle(finding.ruleId, locale, finding.title)");
    expect(read("components/home/HeroFinding.tsx")).not.toMatch(/\{finding\.title/);
  });
});

describe("« Un vrai rapport »: the recorded report itself, its figures read from the run", () => {
  const run = recordedRun(HERO.run);
  const report = run.report;

  it("draws the report with the app's own view (ComplianceReportView), never a copy of its mapping", () => {
    expect(read("components/home/RealReport.tsx")).toContain("ComplianceReportView");
    expect(read("app/[locale]/page.tsx")).toContain("<RealReport");
    expect(read("app/[locale]/page.tsx")).not.toMatch(/analysisFindings|AnalysisReport/);
  });

  it("shows every finding of the run it names: nothing is filtered, and the figures are the run's own", () => {
    expect(read("app/[locale]/page.tsx")).not.toMatch(/homeReport|HOME_HIDDEN/);
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
      expect(words(d.landing).filter((w) => /\d+\s*(rules?|règles?|findings?|constats?|articles?)/i.test(w))).toEqual(
        [],
      );
    }
  });

  it("keeps the details in a fold: run id, date, ruleset and the engine line", () => {
    const home = read("app/[locale]/page.tsx");
    expect(home).toContain("<details");
    for (const needle of ["run.runId", "run.recordedAt", "run.report.rulesetId", "d.proof.powered"]) {
      expect(home).toContain(needle);
    }
    expect(fr.landing.proof.details).toBe("Détails de l'exécution");
    expect(en.landing.proof.details).toBe("Run details");
  });
});
