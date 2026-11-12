import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr",
}));

import Home from "@/app/[locale]/page";
import { HERO } from "@/content/recorded-runs/samples.mjs";
import { verdictOf } from "@/lib/document-face";
import { recordedRun } from "@/lib/recorded-runs";
import { ruleTitle } from "@/lib/rule-text";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const render = async (locale: "en" | "fr") =>
  renderToStaticMarkup(<ThemeProvider>{await Home({ params: Promise.resolve({ locale }) })}</ThemeProvider>);

/** The recorded report on the home (krizaka-internal#2562, slice C): rendered, in both languages. */
describe("the home's real report, rendered", async () => {
  const run = recordedRun(HERO.run);
  const report = run.report;
  const pages = { en: await render("en"), fr: await render("fr") };

  it("draws the report's findings, the quote and the article of each, from the run", () => {
    for (const html of Object.values(pages)) {
      expect(html).toContain('data-testid="compliance-report"');
      const failed = report.findings.filter((f) => f.verdict === "FAIL");
      expect(failed.length).toBeGreaterThan(0);
      for (const f of failed) {
        if (f.evidenceSpan?.quote) {
          expect(html).toContain(f.evidenceSpan.quote);
        }
      }
      expect(html).toContain("art. 1936");
    }
  });

  it("reads its counts from the run: the header says how many of how many rules need a look", () => {
    const rules = report.summary?.rulesEvaluated ?? 0;
    const attention = verdictOf(report).attention;
    expect(attention).toBeGreaterThan(1);
    for (const [locale, d] of [
      ["fr", fr],
      ["en", en],
    ] as const) {
      expect(pages[locale]).toContain(
        d.console.reportFace.attentionMany.replace("{count}", String(attention)).replace("{rules}", String(rules)),
      );
    }
  });

  it("shows every finding of the run it names, and puts forward no security-deposit finding (QC-LEASE-004 is not applicable to this lease)", () => {
    expect(report.findings.length).toBe(run.report.findings.length);
    expect(report.findings.find((f) => f.ruleId === "QC-LEASE-004")?.verdict).toBe("NOT_APPLICABLE");
    for (const html of Object.values(pages)) {
      expect(html).not.toContain("proof-excerpt");
      for (const f of report.findings.filter((x) => x.verdict !== "NOT_APPLICABLE")) {
        expect(html, f.ruleId).toContain(
          ruleTitle(f.ruleId, html === pages.en ? "en" : "fr", f.title).replace(/'/g, "&#x27;"),
        );
      }
    }
  });

  it("keeps the run id, the date, the ruleset and the engine line there", () => {
    for (const html of Object.values(pages)) {
      const fold = html.slice(html.indexOf('data-testid="run-details"'));
      expect(fold).toContain(run.runId);
      expect(fold).toContain(run.report.rulesetId);
      expect(fold).toContain('data-testid="powered-by"');
    }
    expect(pages.fr).toContain("Détails de l&#x27;exécution");
    expect(pages.en).toContain("Run details");
  });

  it("never shows a French rule title on the /en page", () => {
    for (const f of report.findings) {
      const fr = ruleTitle(f.ruleId, "fr", f.title);
      const en = ruleTitle(f.ruleId, "en", f.title);
      if (fr !== en) {
        expect(pages.en).not.toContain(fr.replace(/'/g, "&#x27;"));
      }
    }
  });

  it("keeps the review note the verdict points to, at the foot of the report: no dangling footnote mark", () => {
    expect(run.report.reviewStatus).toBeTruthy();
    expect(pages.en).toContain(en.console.analysis.toReview);
    expect(pages.fr).toContain(fr.console.analysis.toReview.replace(/'/g, "&#x27;"));
  });

  it("has dropped the drawn showcase", () => {
    for (const html of Object.values(pages)) {
      expect(html).not.toContain('id="app"');
      expect(html).not.toContain("screen-findings");
      expect(html).not.toContain("Fictitious data");
    }
  });
});
