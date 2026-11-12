import { KrizakaQueryProvider } from "@krizaka/query";
import { SEEDED_INPUTS } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { ComplianceReportView, TechnicalDetails } from "./ReportFace";

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const finding = (
  ruleId: string,
  title: string,
  verdict: "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE" | "NOT_APPLICABLE",
  severity = "BLOCKING",
  quote?: string,
) => ({
  ruleId,
  title,
  severity,
  verdict,
  explanation: `Explication : ${title}.`,
  citation: `C.c.Q., art. ${ruleId.length}`,
  method: "DETERMINISTIC",
  evidenceSpan: quote ? { quote } : null,
});
const REPORT = {
  rulesetId: "qc-residential-lease",
  rulesetVersion: "2026-06-20",
  jurisdiction: "QC" as const,
  asOf: "2026-10-23",
  reviewStatus: "TO_REVIEW_BY_LAWYER",
  summary: { byVerdict: { FAIL: 2, PASS: 8 }, blockingFailures: 1, rulesEvaluated: 10 },
  findings: [
    finding("R1", "Durée du bail", "PASS"),
    finding("R2", "Dépôt de garantie interdit", "FAIL", "BLOCKING", "dépôt de sécurité de 1 450 $"),
    finding("R3", "Frais de retard", "FAIL", "MAJOR"),
    ...[4, 5, 6, 7, 8, 9, 10].map((n) => finding(`R${n}`, `Règle ${n}`, "PASS" as const)),
  ],
};
const wrap = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const analysis = (inputs: Record<string, string>) => ({
  id: "a1",
  studio: "compliance-check" as const,
  status: "succeeded" as const,
  runId: "run_8f3a2c",
  blueprintVersion: "1.4.0",
  inputs,
  report: REPORT,
  error: null,
  createdAt: "2026-10-23T12:00:00.000Z",
  finishedAt: "2026-10-23T12:00:04.000Z",
});

const view = (report: object, extra: object = {}, locale: "en" | "fr" = "fr") =>
  wrap(<ComplianceReportView report={report as never} {...(extra as object)} />, locale);

describe("the report's face, drawn by AnalysisReport (the UX review's Y5, #321, krizaka-internal#2293)", () => {
  it("never calls a document the engine did not check a clean one (compliance-check 2.0: unsupported or unknown kind)", () => {
    for (const outcome of ["UNSUPPORTED_KIND", "KIND_UNKNOWN"]) {
      const html = view(
        { ...REPORT, rulesetId: "", rulesetVersion: "", findings: [], summary: undefined, outcome },
        {},
        "en",
      );
      const text = readable(html);
      expect(html).toContain('data-tone="neutral"');
      expect(text).not.toContain("No problem found");
      expect(text).toContain(
        outcome === "UNSUPPORTED_KIND"
          ? "No rules for this kind of document yet"
          : "Could not tell what kind of document this is",
      );
    }
    expect(readable(view({ ...REPORT, findings: [], outcome: "KIND_UNKNOWN" }))).toContain(
      "Impossible de dire de quel type de document il s'agit",
    );
  });

  it("says the verdict first — how many rules of how many need a look, how many of them block — with the law's context and no code", () => {
    const html = view(REPORT);
    expect(html).toContain('data-tone="danger"');
    const text = readable(html);
    expect(text).toContain("2 règles sur 10 demandent votre attention");
    expect(text).toContain("1 Bloquant");
    expect(text).toContain("Règles du Québec · en vigueur le");
    expect(text).not.toContain("qc-residential-lease");
    expect(
      readable(
        view({
          ...REPORT,
          findings: REPORT.findings.filter((f) => f.verdict === "PASS"),
          summary: { blockingFailures: 0, rulesEvaluated: 8 },
        }),
      ),
    ).toContain("Aucun problème trouvé sur les 8 règles vérifiées");
    expect(readable(view(REPORT, {}, "en"))).toContain("2 rules of 10 need your attention");
  });

  it("draws no coloured bar and no accent colour of its own: the component carries the report", () => {
    const html = view(REPORT);
    expect(html).not.toContain("border-l-4");
    expect(html).not.toContain("text-accent");
  });

  it("points the review note to the foot of the report (a footnote), never a line in the band", () => {
    const html = view(REPORT);
    expect(html).toContain('href="#fn-1"');
    expect(readable(html)).not.toContain(fr.console.analysis.toReview);
    expect(view({ ...REPORT, reviewStatus: null })).not.toContain('href="#fn-1"');
  });

  it("groups the findings by gravity — blocking, then what to look at — and folds what was met, with its count", () => {
    const html = view(REPORT);
    const text = readable(html);
    expect(text.indexOf("Dépôt de garantie interdit")).toBeLessThan(text.indexOf("Frais de retard"));
    expect(text.indexOf("Frais de retard")).toBeLessThan(text.indexOf("Durée du bail"));
    expect(html).toMatch(/<details[^>]*aria-label="Constats: Respecté"/);
    expect(text).toContain("Respecté · 8");
    expect(html).not.toMatch(/<details[^>]*aria-label="Constats: Bloquant"/);
  });

  it("rules that do not apply are folded apart, in a group of their own, not counted as things to look at", () => {
    const report = {
      ...REPORT,
      findings: [
        finding("R1", "Loyer", "PASS"),
        finding("R2", "Dépôt", "NOT_APPLICABLE", "BLOCKING"),
        finding("R3", "Chèques", "NOT_APPLICABLE", "BLOCKING"),
      ],
    };
    const html = view(report);
    expect(html).toMatch(/<details[^>]*aria-label="Constats: Sans objet"/);
    expect(readable(html)).toContain("Sans objet · 2");
    expect(readable(html)).not.toContain("Bloquant ·");
  });

  it("a report never renders the same finding twice, even when a rule is listed twice", () => {
    const dup = finding("TS-P-001", "Clauses de paiement", "FAIL", "MAJOR");
    const report = { ...REPORT, findings: [...REPORT.findings, dup, dup, { ...dup, explanation: "autre" }] };
    const html = view(report);
    expect(html.match(/>Clauses de paiement<\/h4>/g)).toHaveLength(2);
  });

  it("each finding carries the passage quoted and the article cited, as the run returned them — and says when no passage is quoted; no code and no run id on the face", () => {
    const html = view({ ...REPORT, findings: [...REPORT.findings, finding("R11", "Avis", "FAIL", "INFO")] });
    const text = readable(html);
    expect(text).toContain("« dépôt de sécurité de 1 450 $ »");
    expect(text).toContain("C.c.Q., art. 2");
    expect(text).toContain(fr.console.reportFace.noQuote);
    expect(text).not.toContain(fr.console.analysis.verdicts.FAIL);
    expect(text).not.toMatch(/\bR\d+\b/);
    expect(text).not.toContain("BLOCKING");
    expect(text).not.toContain("DETERMINISTIC");
    expect(text).not.toContain("run_8f3a2c");
    expect(readable(view({ ...REPORT, findings: [{ ...finding("QC-X", "", "FAIL"), title: undefined }] }))).toContain(
      "Règle 1",
    );
    expect(view(REPORT)).not.toContain(fr.console.reportFace.seeInFile);
    expect(view(REPORT, { selection: { activeId: null, onSelect: () => {} } })).toContain(
      fr.console.reportFace.seeInFile,
    );
  });

  it("keeps the run in one fold: the run id once, the engine version and the rules; a seeded check's note is at the report's foot (P11, DocumentView.test)", () => {
    const html = view(REPORT, { analysis: analysis({ jurisdiction: "QC" }) });
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Détails techniques/);
    expect(html.match(/run_8f3a2c/g)).toHaveLength(1);
    const text = readable(html);
    expect(text).toContain("compliance-check · 1.4.0");
    expect(text).toContain("qc-residential-lease · 2026-06-20");
    expect(readable(view(REPORT, { analysis: analysis({ ...SEEDED_INPUTS }) }))).not.toContain(
      fr.console.analysis.seededNote,
    );
  });

  it("keeps the technical details of a run for the history (the run id once, each finding's rule id and method by its number)", () => {
    const html = wrap(<TechnicalDetails documentId="d1" analysis={analysis({ jurisdiction: "QC" })} />);
    expect(html).toContain('data-testid="technical-details"');
    expect(html.match(/run_8f3a2c/g)).toHaveLength(1);
    const text = readable(html);
    expect(text).toContain("1 · R2 · DETERMINISTIC");
    expect(text).toContain("3 · R1 · DETERMINISTIC");
  });

  it("lets a long source address break inside its card, so it never overflows a phone's width (the TAL address of Section G)", () => {
    const url =
      "https://www.tal.gouv.qc.ca/fr/le-bail-de-logement/avis-au-nouveau-locataire-formulaire-de-notification";
    const report = {
      ...REPORT,
      findings: [{ ...finding("TS-G-001", "Avis du TAL absent", "FAIL", "MAJOR"), explanation: `Voir ${url}.` }],
    };
    const html = view(report);
    expect(html).toContain(url);
    // AnalysisReport's own paragraphs do not break a long address: the wrapper makes every paragraph break anywhere.
    expect(html).toContain("[&amp;_p]:[overflow-wrap:anywhere]");
  });

  describe("the header says the overall status once, in words, and keeps the counts", () => {
    const head = (html: string) => readable(html.slice(html.indexOf("<header"), html.indexOf("</header>")));
    const mix = (blocking: number, minor: number, passed: number) => ({
      ...REPORT,
      summary: undefined,
      findings: [
        ...Array.from({ length: blocking }, (_, n) => finding(`B${n}`, `Bloc ${n}`, "FAIL", "BLOCKING")),
        ...Array.from({ length: minor }, (_, n) => finding(`M${n}`, `Mineur ${n}`, "FAIL", "MINOR")),
        ...Array.from({ length: passed }, (_, n) => finding(`P${n}`, `Passé ${n}`, "PASS")),
      ],
    });

    it.each([
      [1, 3, 8, fr.console.reportFace.overall.toFix, "À corriger"],
      [0, 3, 8, fr.console.reportFace.overall.toReview, "À regarder"],
      [0, 0, 8, fr.console.reportFace.overall.nothing, "Rien à signaler"],
    ])("%i blocking, %i to look at, %i met: reads « %s »", (b, m, p, word, expected) => {
      expect(word).toBe(expected);
      const text = head(view(mix(b, m, p)));
      expect(text).toContain(`${word} ·`);
    });

    it("says it in English too", () => {
      expect(en.console.reportFace.overall).toEqual({
        toFix: "To fix",
        toReview: "To review",
        nothing: "Nothing to report",
      });
    });

    it("keeps the counts and shows « Bloquant » once: the package's own chip repeats it, so it is hidden", () => {
      const html = view(mix(1, 3, 8));
      const text = head(html);
      expect(text).toContain("1 Bloquant");
      expect(text).toContain("3 À regarder");
      expect(text).toContain("8 Respecté");
      expect(text).not.toContain("dont 1 bloquante");
      expect(html).toContain("[&amp;_header_.flex-wrap&gt;:first-child]:hidden");
      expect(text.match(/Bloquant/g)).toHaveLength(2); // the hidden chip, and the count
    });
  });
});
