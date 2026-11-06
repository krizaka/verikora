import { describe, expect, it } from "vitest";

import {
  authenticityReport,
  complianceReport,
  finding,
  fromRunStatus,
  isSeededCheck,
  isTerminal,
  passages,
  queryKeys,
  reportOf,
  SEEDED_INPUTS,
  signalFamily,
  startAnalysis,
} from "./index";

// A report exactly as the compliance Studio assembles it (sovkora-packs document-validation worker, `_assemble`).
const COMPLIANCE = {
  report: {
    rulesetId: "fr-residential-lease",
    rulesetVersion: "2026-07-01",
    rulesetRevision: 1,
    jurisdiction: "FR",
    asOf: "2026-10-14",
    source: "Loi n° 89-462 du 6 juillet 1989",
    summary: { byVerdict: { PASS: 5, FAIL: 4, INSUFFICIENT_EVIDENCE: 1 }, blockingFailures: 4, rulesEvaluated: 10 },
    findings: [
      {
        ruleId: "FR-LEASE-005",
        title: "Dépôt de garantie plafonné à un mois de loyer hors charges",
        severity: "BLOCKING",
        verdict: "FAIL",
        evidenceSpan: { start: 160, end: 187, quote: "Dépôt de garantie : 2 550 €" },
        explanation: "Le dépôt de garantie excède un mois de loyer hors charges.",
        method: "DETERMINISTIC",
        citation: "Loi 89-462, art. 22",
      },
      {
        ruleId: "FR-LEASE-008",
        severity: "BLOCKING",
        verdict: "FAIL",
        evidenceSpan: null,
        explanation: "Aucun DPE annexé.",
      },
    ],
  },
};

describe("Sovkora runs", () => {
  it("maps Sovkora's run statuses, an unknown one stays running (asked again)", () => {
    expect(fromRunStatus("SUCCEEDED")).toBe("succeeded");
    expect(fromRunStatus("FAILED")).toBe("failed");
    expect(fromRunStatus("CANCELLED")).toBe("cancelled");
    expect(fromRunStatus("RUNNING")).toBe("running");
    expect(fromRunStatus("COMPENSATING")).toBe("running");
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("failed")).toBe(true);
  });

  it("reads the compliance report from the run's `report` output, wrapped or bare", () => {
    const wrapped = reportOf("compliance-check", [{ key: "report", type: "JSON", value: JSON.stringify(COMPLIANCE) }]);
    expect(complianceReport.parse(wrapped).findings).toHaveLength(2);
    const bare = reportOf("compliance-check", [
      { key: "report", type: "JSON", value: JSON.stringify(COMPLIANCE.report) },
    ]);
    expect(bare).toEqual(wrapped);
  });

  it("reads a compliance-check 2.0 report: the ruleset is nested, the outcome says whether the document was checked", () => {
    const checked = {
      contract: "2.0",
      outcome: "CHECKED",
      identification: {
        outcome: "CHECK",
        detectedKind: "LEASE",
        jurisdiction: "QC",
        asOf: "2026-10-29",
        mismatch: false,
      },
      ruleset: { id: "qc-residential-lease", version: "2026-10-24", revision: 2, reviewStatus: "TO_REVIEW_BY_LAWYER" },
      jurisdiction: "QC",
      asOf: "2026-10-29",
      findings: [
        {
          ruleId: "QC-LEASE-001",
          severity: "BLOCKING",
          verdict: "PASS",
          explanation: "ok",
          checks: { passage: "VERIFIED", citation: "VERIFIED" },
        },
      ],
    };
    const read = reportOf("compliance-check", [{ key: "report", type: "JSON", value: JSON.stringify(checked) }]);
    expect(
      read && "findings" in read
        ? [read.rulesetId, read.rulesetVersion, read.rulesetRevision, read.reviewStatus, read.outcome]
        : null,
    ).toEqual(["qc-residential-lease", "2026-10-24", 2, "TO_REVIEW_BY_LAWYER", "CHECKED"]);
  });

  it("reads a 2.0 report of a document that was not checked (no ruleset, no findings), never as a clean one", () => {
    const unsupported = {
      contract: "2.0",
      outcome: "UNSUPPORTED_KIND",
      identification: { outcome: "UNSUPPORTED_KIND", detectedKind: "NOTICE", jurisdiction: null, asOf: "2026-10-29" },
      asOf: "2026-10-29",
      findings: [],
    };
    const read = reportOf("compliance-check", [{ key: "report", type: "JSON", value: JSON.stringify(unsupported) }]);
    expect(read && "findings" in read ? [read.outcome, read.findings.length, read.rulesetId] : null).toEqual([
      "UNSUPPORTED_KIND",
      0,
      "",
    ]);
  });

  it("reads the authenticity signals from the run's `signals` output", () => {
    const report = {
      header: "Ce rapport n'est pas une expertise.",
      pages: 3,
      signals: [
        { signalId: "PDF-META-002", level: "incohérent", observation: "Le producteur déclaré ne correspond pas." },
      ],
    };
    const read = reportOf("document-authenticity", [
      { key: "report", type: "TEXT", value: "Points à éclaircir…" },
      { key: "signals", type: "JSON", value: JSON.stringify(report) },
    ]);
    expect(read && "signals" in read ? read.signals[0]?.level : null).toBe("incohérent");
  });

  it("reads a signal's evidence and family when the engine sends them, and an old report without them still parses", () => {
    const old = authenticityReport.parse({
      signals: [{ signalId: "PDF-REV-001", level: "inhabituel", observation: "Deux sauvegardes." }],
    });
    expect(old.signals[0]?.evidence).toBeUndefined();
    const rich = authenticityReport.parse({
      signals: [
        {
          signalId: "PDF-REV-002",
          level: "incohérent",
          observation: "x",
          family: "history",
          evidence: { page: 2, box: [72, 600, 240, 618], revision: 2, field: "net" },
        },
      ],
    });
    expect(rich.signals[0]?.evidence).toEqual({ page: 2, box: [72, 600, 240, 618], revision: 2, field: "net" });
    expect(
      authenticityReport.safeParse({
        signals: [{ signalId: "a", level: "observé", observation: "x", evidence: { page: 0 } }],
      }).success,
    ).toBe(false);
  });

  it("puts a signal in a family from its id when the engine names none", () => {
    expect([
      signalFamily({ signalId: "PDF-REV-001" }),
      signalFamily({ signalId: "PDF-FONT-001" }),
      signalFamily({ signalId: "IMG-META-003" }),
      signalFamily({ signalId: "CONTENT-PAY-001" }),
      signalFamily({ signalId: "FILE-002" }),
      signalFamily({ signalId: "XYZ-1" }),
    ]).toEqual(["history", "layout", "images", "figures", "across", "history"]);
    expect(signalFamily({ signalId: "PDF-REV-001", family: "layout" })).toBe("layout");
    expect(signalFamily({ signalId: "PDF-REV-001", family: "nonsense" })).toBe("history");
  });

  it("never guesses: a missing, broken or foreign output is null", () => {
    expect(reportOf("compliance-check", [])).toBeNull();
    expect(reportOf("compliance-check", [{ key: "report", type: "JSON", value: "{not json" }])).toBeNull();
    expect(
      reportOf("document-authenticity", [{ key: "signals", type: "JSON", value: JSON.stringify({ nope: true }) }]),
    ).toBeNull();
  });
});

describe("the API's requests", () => {
  it("asks a jurisdiction for a compliance check, a date in ISO form", () => {
    expect(startAnalysis.parse({ studio: "compliance-check", jurisdiction: "FR" })).toEqual({
      studio: "compliance-check",
      jurisdiction: "FR",
    });
    expect(startAnalysis.parse({ studio: "compliance-check", jurisdiction: "QC" })).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
    });
    expect(() => startAnalysis.parse({ studio: "compliance-check", jurisdiction: "ON" })).toThrow();
    expect(() => startAnalysis.parse({ studio: "compliance-check", jurisdiction: "FR", asOf: "14/10/2026" })).toThrow();
    expect(startAnalysis.parse({ studio: "document-authenticity", expectedIssuer: "  Agence Dupont " })).toEqual({
      studio: "document-authenticity",
      expectedIssuer: "Agence Dupont",
    });
    expect(() => startAnalysis.parse({ studio: "summarise" })).toThrow();
  });

  it("names the Québec invoice rules as a ruleset, for Québec only", () => {
    expect(startAnalysis.parse({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" })).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-invoice",
    });
    expect(() =>
      startAnalysis.parse({ studio: "compliance-check", jurisdiction: "FR", ruleset: "qc-invoice" }),
    ).toThrow();
    expect(() =>
      startAnalysis.parse({ studio: "compliance-check", jurisdiction: "QC", ruleset: "anything" }),
    ).toThrow();
    expect(
      startAnalysis.parse({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-service-contract" }),
    ).toMatchObject({ ruleset: "qc-service-contract" });
    expect(() =>
      startAnalysis.parse({ studio: "compliance-check", jurisdiction: "FR", ruleset: "qc-service-contract" }),
    ).toThrow();
  });

  it("keys the queries so one invalidation reaches every list", () => {
    expect(queryKeys.document("d1").slice(0, 1)).toEqual(queryKeys.documents());
  });
});

describe("passages", () => {
  const text = "Loyer mensuel : 850 €. Dépôt de garantie : 2 550 €. Fin.";
  it("marks each quoted passage where it sits, by offsets or by its first occurrence", () => {
    const parts = passages(text, [{ id: "FR-LEASE-005", quote: "Dépôt de garantie : 2 550 €" }]);
    expect(parts.map((p) => p.mark ?? "")).toEqual(["", "FR-LEASE-005", ""]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });
  it("leaves out a quote the text does not hold, and overlaps", () => {
    const parts = passages(text, [
      { id: "a", quote: "nowhere" },
      { id: "b", quote: "Loyer mensuel", start: 0 },
      { id: "c", quote: "mensuel : 850" },
    ]);
    expect(parts.filter((p) => p.mark).map((p) => p.mark)).toEqual(["b"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });
  it("returns the whole text when nothing is quoted", () => {
    expect(passages("abc", [])).toEqual([{ text: "abc" }]);
    expect(passages("", [])).toEqual([{ text: "" }]);
  });
});

describe("a seeded check (the demo data set) is shown, never certified", () => {
  it("is recognised by the marker the seed writes in its inputs, and nothing else", () => {
    expect(SEEDED_INPUTS).toEqual({ seeded: "true" });
    expect(isSeededCheck({ inputs: { ...SEEDED_INPUTS } })).toBe(true);
    expect(isSeededCheck({ inputs: { seeded: "true", jurisdiction: "QC" } })).toBe(true);
    expect(isSeededCheck({ inputs: {} })).toBe(false);
    expect(isSeededCheck({ inputs: { seeded: "false" } })).toBe(false);
    expect(isSeededCheck({ inputs: { jurisdiction: "QC", asOf: "2026-10-23" } })).toBe(false);
  });
});

describe("a 2.x finding's citation", () => {
  it("is read as its reference (the live 2.0 report carries an object)", () => {
    const f = finding.parse({
      ruleId: "QC-LANG-001",
      severity: "ADVISORY",
      verdict: "PASS",
      explanation: "ok",
      citation: { reference: "C.c.Q., art. 1897", pinned: true, notice: {} },
    });
    expect(f.citation).toBe("C.c.Q., art. 1897");
    expect(
      finding.parse({
        ruleId: "R",
        severity: "ADVISORY",
        verdict: "PASS",
        explanation: "ok",
        citation: "C.c.Q., art. 1",
      }).citation,
    ).toBe("C.c.Q., art. 1");
  });
});
