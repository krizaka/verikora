import type { ComplianceReport, Finding } from "@verikora/core";

/**
 * The line a finding's evidence sits on (verikora#129), 1-based, counted in the document's text: by the offsets when they still match,
 * else by the first occurrence of the quote. A finding with no quote, or a quote not in the text, has no line (null, never a guess).
 */
export function lineOf(text: string, finding: Pick<Finding, "evidenceSpan">): number | null {
  const span = finding.evidenceSpan;
  if (!span?.quote) return null;
  const at =
    typeof span.start === "number" && text.slice(span.start, span.start + span.quote.length) === span.quote
      ? span.start
      : text.indexOf(span.quote);
  if (at < 0) return null;
  return text.slice(0, at).split("\n").length;
}

/** The report with the line of each finding that has one, read while the text is still there (it is purged after the check). */
export function withLines(report: ComplianceReport, text: string): ComplianceReport {
  if (!text) return report;
  return { ...report, findings: report.findings.map((f) => ({ ...f, ...nullToNothing(lineOf(text, f)) })) };
}

const nullToNothing = (line: number | null): { line?: number } => (line === null ? {} : { line });
