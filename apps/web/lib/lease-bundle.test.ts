import type { ComplianceReport } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { bundleOf, DOCUMENT_ROLE } from "./lease-bundle";
import { lineOf, withLines } from "./lease-lines";

const TEXT = "Bail\nLe loyer est payable le 1er.\nLe locataire renonce à tout recours.\nFin";
const report = (over: Partial<ComplianceReport> = {}): ComplianceReport => ({
  rulesetId: "qc-residential-lease",
  rulesetVersion: "1.2.0",
  jurisdiction: "CA-QC",
  asOf: "2026-10-28",
  reviewStatus: "TO_REVIEW_BY_LAWYER",
  findings: [
    {
      ruleId: "R-WAIVER",
      severity: "BLOCKING",
      verdict: "FAIL",
      explanation: "x",
      citation: "C.c.Q. art. 1893",
      evidenceSpan: { start: 36, end: 73, quote: "Le locataire renonce à tout recours." },
    },
    {
      ruleId: "R-RENT",
      severity: "INFO",
      verdict: "PASS",
      explanation: "x",
      evidenceSpan: { quote: "Le loyer est payable le 1er." },
    },
    { ruleId: "R-NONE", severity: "INFO", verdict: "INSUFFICIENT_EVIDENCE", explanation: "x" },
  ],
  ...over,
});

describe("the line of a finding (verikora#129)", () => {
  it("counts lines from the offsets, else from the first occurrence of the quote, else says nothing", () => {
    expect(lineOf(TEXT, { evidenceSpan: { start: 40, quote: "Le locataire renonce à tout recours." } })).toBe(3);
    expect(lineOf(TEXT, { evidenceSpan: { start: 2, quote: "Le loyer est payable le 1er." } })).toBe(2);
    expect(lineOf(TEXT, { evidenceSpan: { quote: "absent" } })).toBeNull();
    expect(lineOf(TEXT, { evidenceSpan: null })).toBeNull();
    expect(lineOf(TEXT, {})).toBeNull();
  });

  it("writes the line on the findings that have one, and leaves the report alone when the text is gone", () => {
    expect(withLines(report(), TEXT).findings.map((f) => f.line)).toEqual([3, 2, undefined]);
    const purged = report();
    expect(withLines(purged, "")).toBe(purged);
  });
});

describe("a lease and its annexes read as one (verikora#129)", () => {
  const annex = report({
    findings: [
      {
        ruleId: "R-ANNEX",
        severity: "BLOCKING",
        verdict: "FAIL",
        explanation: "x",
        citation: "C.c.Q. art. 1900",
        line: 7,
        evidenceSpan: { quote: "clause" },
      },
    ],
  });
  const docs = [
    { id: "lease", title: "Bail", role: DOCUMENT_ROLE.lease, report: withLines(report(), TEXT) },
    { id: "annex-1", title: "Annexe A", role: DOCUMENT_ROLE.annex, report: annex },
    { id: "rules-1", title: "Règlement", role: DOCUMENT_ROLE.buildingRules, report: null },
  ];
  const bundle = bundleOf("lease", docs);

  it("shows per finding the document, the line, the exact text, the rule and the article", () => {
    expect(bundle.lines.filter((l) => l.verdict === "FAIL")).toEqual([
      expect.objectContaining({
        documentId: "lease",
        role: "lease",
        line: 3,
        quote: "Le locataire renonce à tout recours.",
        ruleId: "R-WAIVER",
        article: "C.c.Q. art. 1893",
      }),
      expect.objectContaining({
        documentId: "annex-1",
        role: "annex",
        line: 7,
        quote: "clause",
        ruleId: "R-ANNEX",
        article: "C.c.Q. art. 1900",
      }),
    ]);
    expect(bundle.lines.map((l) => l.line)).toEqual([2, 3, null, 7]);
  });

  it("states the ruleset's review status while it is TO_REVIEW_BY_LAWYER, once for the one ruleset", () => {
    expect(bundle.rulesets).toEqual([
      {
        jurisdiction: "CA-QC",
        rulesetId: "qc-residential-lease",
        rulesetVersion: "1.2.0",
        reviewStatus: "TO_REVIEW_BY_LAWYER",
      },
    ]);
  });

  it("says which documents were not checked yet, and gives no advice or verdict about the lease", () => {
    expect(bundle.documents.map((d) => d.checked)).toEqual([true, true, false]);
    expect(JSON.stringify(bundle)).not.toMatch(/conforme|approuv|refus|compliant|approved|should|devez|il faut/i);
  });
});
