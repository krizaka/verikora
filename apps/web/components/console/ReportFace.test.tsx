import { KrizakaQueryProvider } from "@krizaka/query";
import { SEEDED_INPUTS } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { FindingList, TechnicalDetails, VerdictBand } from "./ReportFace";

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

describe("the report's face (the UX review's Y5, the report of #321)", () => {
  it("never calls a document the engine did not check a clean one (compliance-check 2.0: unsupported or unknown kind)", () => {
    for (const outcome of ["UNSUPPORTED_KIND", "KIND_UNKNOWN"]) {
      const html = wrap(
        <VerdictBand
          report={{ ...REPORT, rulesetId: "", rulesetVersion: "", findings: [], summary: undefined, outcome } as never}
        />,
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
    expect(
      readable(wrap(<VerdictBand report={{ ...REPORT, findings: [], outcome: "KIND_UNKNOWN" } as never} />, "fr")),
    ).toContain("Impossible de dire de quel type de document il s'agit");
  });

  it("says the verdict first — how many rules of how many need a look, how many of them block — with the law's context and no code", () => {
    const html = wrap(<VerdictBand report={REPORT as never} />);
    expect(html).toContain('data-tone="danger"');
    const text = readable(html);
    expect(text).toContain("2 règles sur 10 demandent votre attention");
    expect(text).toContain("dont 1 bloquante");
    expect(text).toContain("Règles du Québec · en vigueur le");
    expect(text).not.toContain("qc-residential-lease");
    expect(
      readable(
        wrap(
          <VerdictBand
            report={
              {
                ...REPORT,
                findings: REPORT.findings.filter((f) => f.verdict === "PASS"),
                summary: { blockingFailures: 0, rulesEvaluated: 8 },
              } as never
            }
          />,
        ),
      ),
    ).toContain("Aucun problème trouvé sur les 8 règles vérifiées");
    expect(readable(wrap(<VerdictBand report={REPORT as never} />, "en"))).toContain(
      "2 rules of 10 need your attention",
    );
  });

  it("points the review note to the foot of the report (a footnote), never a line in the band", () => {
    const html = wrap(<VerdictBand report={REPORT as never} />);
    expect(html).toContain('href="#fn-1"');
    expect(readable(html)).not.toContain(fr.console.analysis.toReview);
    expect(wrap(<VerdictBand report={{ ...REPORT, reviewStatus: null } as never} />)).not.toContain('href="#fn-1"');
  });

  it("numbers the findings in reading order — what failed first, blocking before important — and folds what passed, numbered on", () => {
    const html = wrap(<FindingList report={REPORT as never} />);
    const text = readable(html);
    expect(text).toMatch(/1 Dépôt de garantie interdit .*2 Frais de retard/);
    expect(text.indexOf("Frais de retard")).toBeLessThan(text.indexOf("Durée du bail"));
    expect(html).toMatch(/<ol[^>]*start="3"/);
    expect(text).toMatch(/3 Durée du bail/);
    expect(html).toContain('data-testid="passed-findings"');
    expect(text).toContain("8 règles respectées");
  });

  it("rules that do not apply are folded apart, with no severity chip and not counted as things to look at", () => {
    const report = {
      ...REPORT,
      findings: [
        finding("R1", "Loyer", "PASS"),
        finding("R2", "Dépôt", "NOT_APPLICABLE", "BLOCKING"),
        finding("R3", "Chèques", "NOT_APPLICABLE", "BLOCKING"),
      ],
    };
    const html = wrap(<FindingList report={report as never} />);
    expect(html).toContain('data-testid="not-applicable-findings"');
    expect(readable(html)).toContain("2 règles qui ne s'appliquent pas");
    expect(html).not.toContain('data-testid="finding-list"><ol');
    expect(readable(html)).not.toContain("Bloquant");
  });

  it("a report never renders the same id twice, even when a rule is listed twice", () => {
    const dup = finding("TS-P-001", "Clauses de paiement", "FAIL", "MAJOR");
    const report = { ...REPORT, findings: [...REPORT.findings, dup, dup, { ...dup, explanation: "autre" }] };
    const ids = [...wrap(<FindingList report={report as never} />).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says each severity as a word — Bloquant · Important · À considérer — and the passage or that none is quoted; no code and no run id on the face", () => {
    const text = readable(
      wrap(
        <FindingList
          report={{ ...REPORT, findings: [...REPORT.findings, finding("R11", "Avis", "FAIL", "INFO")] } as never}
        />,
      ),
    );
    expect(text).toContain("Bloquant");
    expect(text).toContain("Important");
    expect(text).toContain("À considérer");
    expect(text).not.toContain(fr.console.analysis.verdicts.FAIL);
    expect(text).toContain("« dépôt de sécurité de 1 450 $ »");
    expect(text).toContain(fr.console.reportFace.noQuote);
    expect(text).not.toMatch(/\bR\d+\b/);
    expect(text).not.toContain("BLOCKING");
    expect(text).not.toContain("DETERMINISTIC");
    expect(text).not.toContain("run_8f3a2c");
    expect(
      readable(
        wrap(
          <FindingList
            report={{ ...REPORT, findings: [{ ...finding("QC-X", "", "FAIL"), title: undefined }] } as never}
          />,
        ),
      ),
    ).toContain("1 Règle 1");
    expect(wrap(<FindingList report={REPORT as never} />)).not.toContain(fr.console.reportFace.seeInFile);
    expect(wrap(<FindingList report={REPORT as never} selection={{ activeId: null, onSelect: () => {} }} />)).toContain(
      fr.console.reportFace.seeInFile,
    );
  });

  it("keeps the engine's facts folded — the run id once, each finding's rule id and method by its number; a seeded check's note is at the report's foot, not here (P11, DocumentView.test)", () => {
    const html = wrap(<TechnicalDetails documentId="d1" analysis={analysis({ jurisdiction: "QC" })} />);
    expect(html).toContain('data-testid="technical-details"');
    expect(html.match(/run_8f3a2c/g)).toHaveLength(1);
    const text = readable(html);
    expect(text).toContain("compliance-check · 1.4.0");
    expect(text).toContain("1 · R2 · DETERMINISTIC");
    expect(text).toContain("3 · R1 · DETERMINISTIC");
    expect(
      readable(wrap(<TechnicalDetails documentId="d1" analysis={analysis({ ...SEEDED_INPUTS })} />)),
    ).not.toContain(fr.console.analysis.seededNote);
  });

  it("lets a long source address break inside its card, so it never overflows a phone's width (the TAL address of Section G)", () => {
    const url =
      "https://www.tal.gouv.qc.ca/fr/le-bail-de-logement/avis-au-nouveau-locataire-formulaire-de-notification";
    const report = {
      ...REPORT,
      findings: [{ ...finding("TS-G-001", "Avis du TAL absent", "FAIL", "MAJOR"), explanation: `Voir ${url}.` }],
    };
    const html = wrap(<FindingList report={report as never} />);
    expect(html).toContain(url);
    const paragraph = html.match(/<p class="([^"]*)">Voir /)?.[1] ?? "";
    expect(paragraph).toContain("[overflow-wrap:anywhere]");
  });
});
