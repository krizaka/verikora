import type { ComplianceReport, Finding } from "@verikora/core";

/**
 * Adds one deterministic finding to a report, once (a report already holding the rule's id is returned as it came), and counts it in
 * the summary the way the engine's own findings are counted (verikora#104: the tenant-shield rules reach the report one finding each).
 */
export function appendFinding(report: ComplianceReport, finding: Finding): ComplianceReport {
  if (report.findings.some((f) => f.ruleId === finding.ruleId)) return report;
  const byVerdict = {
    ...report.summary?.byVerdict,
    [finding.verdict]: (report.summary?.byVerdict?.[finding.verdict] ?? 0) + 1,
  };
  return {
    ...report,
    findings: [...report.findings, finding],
    summary: {
      ...report.summary,
      byVerdict,
      rulesEvaluated: (report.summary?.rulesEvaluated ?? report.findings.length) + 1,
    },
  };
}
