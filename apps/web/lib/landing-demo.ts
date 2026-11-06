import type { OwnerDocument } from "./owner-report";
import type { RecordedRun } from "./recorded-runs";

/** The home's owner card: the recorded tenant run, shaped as the owner's page shows a document (its fingerprint, its failed findings, its run). */
export function demoOwnerDocument(
  run: Pick<RecordedRun, "document" | "report" | "runId" | "studioVersion" | "finishedAt">,
): OwnerDocument {
  return {
    typeId: "lease",
    sha256: run.document.sha256,
    pages: null,
    signals: [],
    findings: run.report.findings
      .filter((f) => f.verdict === "FAIL" || f.verdict === "INSUFFICIENT_EVIDENCE")
      .slice(0, 2)
      .map((f) => ({ ruleId: f.ruleId, verdict: f.verdict, severity: f.severity, citation: f.citation ?? null })),
    notExamined: [],
    runs: [
      { studio: "compliance-check", runId: run.runId, studioVersion: run.studioVersion, finishedAt: run.finishedAt },
    ],
  };
}
