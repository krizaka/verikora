import { readFileSync } from "node:fs";

import { type Analysis, type ComplianceReport, passages, reportOf } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { buildPayload, issueReport, sha256, verifyReport } from "./report";
import { generateSigningKeyBase64, parseSigningKey } from "./report-key";
import { reportLabels } from "./report-labels";

// The compliance report of a REAL run of Sovkora's Studio (blueprint 1.2.0, dev.sovkora.com, 2026-10-15, run
// ba5a20f1-d67e-4966-ac55-dc40db6bf1b5) on the sample Québec lease, exactly as it came back — nine findings, one of
// which quotes a passage without offsets (`evidenceSpan.start/end: null`), which the first version of the schema refused.
const RAW = readFileSync(new URL("./fixtures/sovkora-compliance-qc-1.2.0.json", import.meta.url), "utf8");

describe("a real Sovkora compliance report", () => {
  it("is read in full, including a quoted passage whose offsets are null", () => {
    const report = reportOf("compliance-check", [
      { key: "report", type: "JSON", value: RAW },
    ]) as ComplianceReport | null;
    expect(report).not.toBeNull();
    expect(report!.findings).toHaveLength(9);
    expect(report!.findings.some((f) => f.evidenceSpan && f.evidenceSpan.start == null && f.evidenceSpan.quote)).toBe(
      true,
    );
  });

  it("marks a quote with null offsets in the text by searching for it", () => {
    const report = reportOf("compliance-check", [{ key: "report", type: "JSON", value: RAW }]) as ComplianceReport;
    const nullSpan = report.findings.find((f) => f.evidenceSpan && f.evidenceSpan.start == null)!;
    const quote = nullSpan.evidenceSpan!.quote;
    const text = `avant ${quote} après`;
    expect(
      passages(text, [{ id: nullSpan.ruleId, quote, start: nullSpan.evidenceSpan!.start ?? undefined }]).some(
        (p) => p.mark === nullSpan.ruleId,
      ),
    ).toBe(true);
  });

  it("gives a signed report that verifies, and fails once a finding is changed", () => {
    const report = reportOf("compliance-check", [{ key: "report", type: "JSON", value: RAW }]) as ComplianceReport;
    const analysis: Analysis = {
      id: "a",
      studio: "compliance-check",
      status: "succeeded",
      runId: "ba5a20f1-d67e-4966-ac55-dc40db6bf1b5",
      blueprintVersion: "1.2.0",
      inputs: {},
      report,
      error: null,
      createdAt: "2026-10-15T06:24:26.213Z",
      finishedAt: "2026-10-15T06:24:40.000Z",
    };
    const key = parseSigningKey(generateSigningKeyBase64());
    const issued = issueReport(
      buildPayload(
        { sha256: sha256("x"), filename: "bail.pdf", title: "Bail", sizeBytes: 1, pages: 2 },
        analysis,
        "fr",
      ),
      reportLabels("fr"),
      key,
    );
    expect(verifyReport(issued.html, key)).toMatchObject({ ok: true });
    expect(issued.attestation.payload.findings).toHaveLength(9);
    expect(verifyReport(issued.html.replace("QC-LEASE-004", "QC-LEASE-994"), key)).toMatchObject({ ok: false });
  });
});
