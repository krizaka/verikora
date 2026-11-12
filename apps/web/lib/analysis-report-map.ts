import type { AnalysisFinding, AnalysisStatus } from "@krizaka/ui/analysis-report";
import type { Finding } from "@verikora/core";

import { NOT_APPLICABLE, numberFindings, type VerdictTone } from "@/lib/document-face";
import { ruleExplanation, ruleTitle } from "@/lib/rule-text";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** How a rule reads in `AnalysisReport`'s four statuses: a blocking failure is « inconsistent », any other point to look at (or a rule that could not be checked) « attention », a met rule « consistent », a rule that does not apply « unverified » (both calm groups are folded). */
export function analysisStatusOf(f: Pick<Finding, "verdict" | "severity">): AnalysisStatus {
  if (f.verdict === "PASS") {
    return "consistent";
  }
  if (f.verdict === NOT_APPLICABLE) {
    return "unverified";
  }
  return f.severity === "BLOCKING" && f.verdict === "FAIL" ? "inconsistent" : "attention";
}

/** The report's overall status, from the tone of its verdict. */
export function analysisStatusOfTone(tone: VerdictTone): AnalysisStatus {
  if (tone === "danger") {
    return "inconsistent";
  }
  return tone === "warning" ? "attention" : "consistent";
}

/**
 * The run's findings as the component's: the passage and the article come from the Sovkora report (`evidenceSpan.quote`,
 * `citation`), never typed here; the order is the reading order of `numberFindings`, the id the finding's anchor.
 */
export function analysisFindings(
  findings: readonly Finding[],
  say: Say,
  locale: "en" | "fr",
  locatable = false,
): { findings: AnalysisFinding[]; ruleIdOf: Map<string, string> } {
  const { attention, passed, notApplicable } = numberFindings(findings);
  const ruleIdOf = new Map<string, string>();
  const mapped = [...attention, ...passed, ...notApplicable].map(({ n, finding: f, anchor }) => {
    ruleIdOf.set(anchor, f.ruleId);
    const status = analysisStatusOf(f);
    const quote = f.evidenceSpan?.quote;
    const notes = [
      f.verdict === "INSUFFICIENT_EVIDENCE" ? `${say("analysis.verdicts.INSUFFICIENT_EVIDENCE")}.` : "",
      ruleExplanation(f.ruleId, locale, f.explanation, f.explanationEn),
      !quote && (status === "inconsistent" || status === "attention") ? `(${say("reportFace.noQuote")})` : "",
    ].filter(Boolean);
    return {
      id: anchor,
      status,
      title: f.title ? ruleTitle(f.ruleId, locale, f.title) : say("reportFace.rule", { n }),
      observation: notes.join(" "),
      ...(quote ? { quote } : {}),
      ...(locatable && quote ? { location: say("reportFace.seeInFile") } : {}),
      ...(f.citation ? { reference: { label: f.citation } } : {}),
    } satisfies AnalysisFinding;
  });
  return { findings: mapped, ruleIdOf };
}
