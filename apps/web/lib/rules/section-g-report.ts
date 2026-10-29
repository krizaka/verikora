import type { ComplianceReport } from "@yomizaka/core";

import fr from "../../messages/fr.json";
import { TAL } from "../brief/tal";
import { talTableFrom } from "../brief/tal-settings";
import { ruleTitle } from "../rule-text";
import { checkSectionG } from "./section-g";
import { sectionGInputFromFacts } from "./section-g-facts";
import { sectionGFinding } from "./section-g-finding";

/** The lease ruleset whose report exposes the rents (`facts`) Section G reads. */
export const LEASE_RULESET = "qc-residential-lease";

type Reader = Parameters<typeof talTableFrom>[0];

/**
 * Adds Section G's finding (TS-G-001) to a Québec lease report that carries the rents, once, as the report is kept (yomizaka#554).
 * The stored text is French like the engine's own findings; the catalogue entry gives the title in the reader's language. A report
 * without the rents, a result that makes no claim, or a report already holding the finding is returned as it came.
 */
export async function withSectionG(report: ComplianceReport, settings: Reader): Promise<ComplianceReport> {
  if (report.rulesetId !== LEASE_RULESET || report.findings.some((f) => f.ruleId === "TS-G-001")) return report;
  const input = sectionGInputFromFacts(report.facts, report.asOf);
  if (!input) return report;
  const shaped = sectionGFinding(checkSectionG(input, await talTableFrom(settings, TAL)), "fr", fr.sectionG, ruleTitle("TS-G-001", "fr", null));
  if (!shaped) return report;
  const finding = { ruleId: shaped.ruleId, title: shaped.title ?? undefined, severity: shaped.severity, verdict: shaped.verdict, explanation: shaped.explanation, method: shaped.method ?? undefined, citation: shaped.citation ?? undefined };
  const byVerdict = { ...report.summary?.byVerdict, [finding.verdict]: (report.summary?.byVerdict?.[finding.verdict] ?? 0) + 1 };
  return { ...report, findings: [...report.findings, finding], summary: { ...report.summary, byVerdict, rulesEvaluated: (report.summary?.rulesEvaluated ?? report.findings.length) + 1 } };
}
