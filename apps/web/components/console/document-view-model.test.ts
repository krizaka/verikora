import { SEEDED_INPUTS } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { complianceOptions, documentFacts, highlightsOf, offeredKinds, placeOf } from "./document-view-model";

const report = {
  rulesetId: "qc-residential-lease",
  rulesetVersion: "2026-06-20",
  jurisdiction: "QC",
  asOf: "2026-10-23",
  summary: { byVerdict: { FAIL: 1 }, blockingFailures: 1, rulesEvaluated: 1 },
  findings: [
    {
      ruleId: "R1",
      title: "Dépôt",
      severity: "BLOCKING",
      verdict: "FAIL",
      explanation: "…",
      evidenceSpan: { quote: "dépôt" },
      method: "DETERMINISTIC",
    },
  ],
};
const run = (id: string, studio: string, extra: Record<string, unknown> = {}) => ({
  id,
  studio,
  status: "succeeded",
  runId: `run_${id}`,
  blueprintVersion: "1.4.0",
  inputs: {},
  report: studio === "compliance-check" ? report : { header: null, signals: [] },
  error: null,
  createdAt: "2026-10-23T12:00:00.000Z",
  finishedAt: null,
  ...extra,
});
const doc = (analyses: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id: "d1", mimeType: "application/pdf", analyses, ...extra }) as never;

/** What the document page derives from a document (verikora#320: DocumentView decomposed, nothing visible changed). */
describe("the document's facts", () => {
  it("takes the latest compliance report, or the run the history opened (`?run=`), and the latest authenticity report", () => {
    const analyses = [run("a2", "compliance-check"), run("a1", "compliance-check"), run("x1", "document-authenticity")];
    expect(documentFacts(doc(analyses), { run: null, locale: "fr" }).latestCompliance?.id).toBe("a2");
    expect(documentFacts(doc(analyses), { run: "a1", locale: "fr" }).latestCompliance?.id).toBe("a1");
    expect(documentFacts(doc(analyses), { run: "nope", locale: "fr" }).latestCompliance?.id).toBe("a2");
    expect(documentFacts(doc(analyses), { run: null, locale: "fr" }).latestAuthenticity?.id).toBe("x1");
  });

  it("offers the signed report of a real run only, at its address in the page's language", () => {
    const facts = documentFacts(doc([run("a2", "compliance-check")]), { run: null, locale: "en" });
    expect(facts.certifiable).toBe(true);
    expect(facts.reportHref).toBe("/api/documents/d1/analyses/a2/report?lang=en");
    const seeded = documentFacts(doc([run("a2", "compliance-check", { inputs: SEEDED_INPUTS })]), {
      run: null,
      locale: "en",
    });
    expect(seeded.certifiable).toBe(false);
    expect(documentFacts(doc([]), { run: null, locale: "fr" }).reportHref).toBeNull();
  });

  it("shows the history tab only with more than one run, and knows which Studio runs and which runs failed", () => {
    expect(documentFacts(doc([run("a1", "compliance-check")]), { run: null, locale: "fr" }).tabs).toEqual([
      "rapport",
      "document",
    ]);
    const facts = documentFacts(
      doc([
        run("a2", "document-authenticity", { status: "running", report: null }),
        run("a1", "compliance-check", { error: "boom" }),
      ]),
      { run: null, locale: "fr" },
    );
    expect(facts.tabs).toEqual(["rapport", "document", "historique"]);
    expect(facts.runningStudio).toBe("document-authenticity");
    expect(facts.running("document-authenticity")).toBe(true);
    expect(facts.running("compliance-check")).toBe(false);
    expect(facts.failures.map((a) => a.id)).toEqual(["a1"]);
  });

  it("reads a PDF, a Word or an OpenDocument file as examinable, and a text file not", () => {
    expect(documentFacts(doc([]), { run: null, locale: "fr" })).toMatchObject({ isPdf: true, examinable: true });
    expect(documentFacts(doc([], { mimeType: "text/plain" }), { run: null, locale: "fr" })).toMatchObject({
      isPdf: false,
      examinable: false,
    });
    expect(
      documentFacts(doc([], { mimeType: "application/vnd.oasis.opendocument.text" }), { run: null, locale: "fr" })
        .examinable,
    ).toBe(true);
  });
});

describe("the kinds the compliance form offers", () => {
  it("always offers a lease, then each kind whose ruleset the flows name", () => {
    expect(offeredKinds([])).toEqual(["lease"]);
    expect(offeredKinds(["qc-premises-condition", "qc-invoice", "qc-visit-notice", "qc-service-contract"])).toEqual([
      "lease",
      "invoice",
      "contract",
      "visit-notice",
      "premises-condition",
    ]);
  });
  it("adds the detected and the declared kinds on a mismatch, once each", () => {
    expect(complianceOptions(null, ["lease"], "lease")).toEqual(["lease"]);
    expect(complianceOptions({ declared: "lease", detected: "invoice" }, ["lease"], "lease")).toEqual([
      "lease",
      "invoice",
    ]);
    expect(complianceOptions({ declared: "other", detected: "invoice" }, ["lease", "invoice"], "other")).toEqual([
      "lease",
      "invoice",
    ]);
  });
});

describe("where a finding sits, in words", () => {
  const say = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
  it("says nothing before the viewer looked, « not found » when it did not, and the page otherwise", () => {
    expect(placeOf(undefined, say)).toBeNull();
    expect(placeOf(null, say)).toBe("analysis.findingNotFound");
    expect(placeOf({ page: 2, match: "page" } as never, say)).toBe('analysis.findingPageOnly{"page":2}');
    expect(placeOf({ page: 3, match: "text" } as never, say)).toBe('analysis.findingPage{"page":3}');
  });
});

describe("the passages the viewer lights", () => {
  it("are the findings that quote the file, under their title (the rule's id without one)", () => {
    expect(highlightsOf(null)).toEqual([]);
    const findings = [
      report.findings[0],
      { ...report.findings[0], ruleId: "R2", title: undefined, evidenceSpan: { quote: "loyer" } },
      { ...report.findings[0], ruleId: "R3", evidenceSpan: undefined },
    ];
    expect(highlightsOf({ ...report, findings } as never)).toEqual([
      { id: "R1", quote: "dépôt", label: "Dépôt" },
      { id: "R2", quote: "loyer", label: "R2" },
    ]);
  });
});
