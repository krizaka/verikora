import type { ComplianceReport, DocumentInsight } from "@verikora/core";

/* Pure (no database, no clock): what the document page shows first — the UX review's Y5 (D1 → D5). The client reads it too. */

type Finding = ComplianceReport["findings"][number];
type Understanding = DocumentInsight["understanding"];

/** The party that names a document, by what the reader is most likely to look for: the other side first, then the issuer. */
const PARTY_ORDER = [
  "tenant",
  "landlord",
  "client",
  "contractor",
  "supplier",
  "buyer",
  "employee",
  "employer",
  "holder",
  "company",
] as const;

/** A document's title as the insight knows it — « Bail de logement — Camille Fictif-Beaulieu » — never the filename when the kind is known; the filename stays as the subtitle (the review's B2). */
export function displayTitle(
  doc: { title: string; insight?: { understanding: Pick<Understanding, "nature" | "parties" | "issuer"> } | null },
  lang: "fr" | "en",
): string {
  const u = doc.insight?.understanding;
  const nature = u?.nature;
  if (!u || !nature || (nature.confidence !== "high" && nature.confidence !== "medium")) {
    return doc.title;
  }
  const party =
    PARTY_ORDER.map((role) => u.parties.find((p) => p.role === role)?.name).find(Boolean) ??
    u.parties[0]?.name ??
    u.issuer ??
    null;
  const title = party ? `${nature.label[lang]} — ${party}` : nature.label[lang];
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}

export type VerdictTone = "success" | "warning" | "danger";

/** The verdict in figures, from the report alone (never a verdict of Verikora's): the rules read, the points to look at, how many block. */
export function verdictOf(report: Pick<ComplianceReport, "findings" | "summary">): {
  rules: number;
  attention: number;
  blocking: number;
  unsure: number;
  passed: number;
  tone: VerdictTone;
} {
  const findings = report.findings;
  const failed = findings.filter((f) => f.verdict === "FAIL");
  const unsure = findings.filter((f) => f.verdict === "INSUFFICIENT_EVIDENCE").length;
  const passed = findings.filter((f) => f.verdict === "PASS").length;
  const blocking = report.summary?.blockingFailures ?? failed.filter((f) => f.severity === "BLOCKING").length;
  const rules = report.summary?.rulesEvaluated ?? findings.length;
  const attention = failed.length + unsure;
  const calm = attention > 0 ? "warning" : "success";
  return { rules, attention, blocking, unsure, passed, tone: blocking > 0 ? "danger" : calm };
}

const SEVERITY_RANK: Record<string, number> = { BLOCKING: 0, MAJOR: 1, MINOR: 2, INFO: 3 };
const VERDICT_RANK: Record<string, number> = { FAIL: 0, INSUFFICIENT_EVIDENCE: 1, PASS: 2 };
/** The verdict of a rule the document gives no occasion for: not a point to look at, and not a pass either. */
export const NOT_APPLICABLE = "NOT_APPLICABLE";

/** The findings in the order the reader needs: what failed first (blocking before the rest), what could not be checked, then what passed — folded (the review's D1) — and, apart, the rules that do not apply to this document. */
export function orderFindings<F extends Pick<Finding, "verdict" | "severity">>(
  findings: readonly F[],
): { attention: F[]; passed: F[]; notApplicable: F[] } {
  const rank = (f: F) => (VERDICT_RANK[f.verdict] ?? 9) * 10 + (SEVERITY_RANK[f.severity] ?? 9);
  const sorted = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f);
  return {
    attention: sorted.filter((f) => f.verdict !== "PASS" && f.verdict !== NOT_APPLICABLE),
    passed: sorted.filter((f) => f.verdict === "PASS"),
    notApplicable: sorted.filter((f) => f.verdict === NOT_APPLICABLE),
  };
}

/** A finding with its number on the report: numbered in reading order, what needs a look from 1, what passed going on from there (the signed PDF numbers them the same way). */
export interface NumberedFinding<F extends Pick<Finding, "verdict" | "severity"> = Finding> {
  n: number;
  finding: F;
  anchor: string;
}

/**
 * A rule listed twice is listed once: the same rule with the same verdict and words is a repeat (an engine report nested twice, a rule
 * added again) and is dropped; a second, different finding of one rule stays but gets its own anchor, so an id never appears twice on a page.
 */
export function uniqueFindings<
  F extends Pick<Finding, "verdict" | "severity"> & { ruleId: string; explanation?: string },
>(findings: readonly F[]): { finding: F; anchor: string }[] {
  const seen = new Set<string>();
  const perRule = new Map<string, number>();
  const out: { finding: F; anchor: string }[] = [];
  for (const finding of findings) {
    const same = `${finding.ruleId}|${finding.verdict}|${finding.explanation ?? ""}`;
    if (seen.has(same)) {
      continue;
    }
    seen.add(same);
    const k = (perRule.get(finding.ruleId) ?? 0) + 1;
    perRule.set(finding.ruleId, k);
    out.push({ finding, anchor: k === 1 ? `finding-${finding.ruleId}` : `finding-${finding.ruleId}-${k}` });
  }
  return out;
}

/** The findings of `orderFindings`, numbered (the Cahier's order: numbers only for a sequence, design § 3.2); a rule listed twice is listed once, each finding with its own anchor. */
export function numberFindings<F extends Pick<Finding, "verdict" | "severity" | "ruleId"> & { explanation?: string }>(
  findings: readonly F[],
): { attention: NumberedFinding<F>[]; passed: NumberedFinding<F>[]; notApplicable: NumberedFinding<F>[] } {
  const anchors = new Map<F, string>(uniqueFindings(findings).map(({ finding, anchor }) => [finding, anchor]));
  const { attention, passed, notApplicable } = orderFindings([...anchors.keys()]);
  const number = (list: F[], from: number) =>
    list.map((finding, i) => ({ n: from + i + 1, finding, anchor: anchors.get(finding)! }));
  return {
    attention: number(attention, 0),
    passed: number(passed, attention.length),
    notApplicable: number(notApplicable, attention.length + passed.length),
  };
}

export type SeverityWord = "blocking" | "major" | "advice";

/** A severity in words and tone (the review's D2): bloquant · majeur · conseil — the code stays in the technical details. */
export function severityOf(severity: string): { word: SeverityWord; tone: VerdictTone | "neutral" } {
  if (severity === "BLOCKING") {
    return { word: "blocking", tone: "danger" };
  }
  if (severity === "MAJOR") {
    return { word: "major", tone: "warning" };
  }
  return { word: "advice", tone: "neutral" };
}

/** One amount per kind — the first the insight found — so « Loyer » never appears twice (the review's D3). */
export function amountsOnce<T extends { kind: string }>(amounts: readonly T[]): T[] {
  const seen = new Set<string>();
  return amounts.filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
}
