import type { ComplianceReport } from "@verikora/core";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { TAL } from "../brief/tal";
import { talTableFrom } from "../brief/tal-settings";
import { ruleTitle } from "../rule-text";
import { appendFinding } from "./report-finding";
import { checkSectionG } from "./section-g";
import { sectionGDeadline } from "./section-g-deadline";
import { deadlineInputFromFacts } from "./section-g-deadline-facts";
import { sectionGInputFromFacts } from "./section-g-facts";
import { sectionGFinding } from "./section-g-finding";
import { requestSentences } from "./section-g-request-text";

/** The lease ruleset whose report exposes the rents (`facts`) Section G reads. */
export const LEASE_RULESET = "qc-residential-lease";

type Reader = Parameters<typeof talTableFrom>[0];

/**
 * Adds Section G's finding (TS-G-001) to a Québec lease report that carries the rents, once, as the report is kept (verikora#554).
 * The stored text is French like the engine's own findings; the catalogue entry gives the title in the reader's language. A report
 * without the rents, a result that makes no claim, or a report already holding the finding is returned as it came.
 */
export async function withSectionG(report: ComplianceReport, settings: Reader): Promise<ComplianceReport> {
  if (report.rulesetId !== LEASE_RULESET || report.findings.some((f) => f.ruleId === "TS-G-001")) return report;
  const input = sectionGInputFromFacts(report.facts, report.asOf);
  if (!input) return report;
  const result = checkSectionG(input, await talTableFrom(settings, TAL));
  const dated = deadlineInputFromFacts(report.facts, report.asOf);
  const deadline = dated ? sectionGDeadline(dated) : null;
  const shaped = sectionGFinding(
    result,
    "fr",
    fr.sectionG,
    ruleTitle("TS-G-001", "fr", null),
    requestSentences(result, deadline, "fr", { deadline: fr.sectionGDeadline, request: fr.sectionGRequest }),
  );
  const english = sectionGFinding(
    result,
    "en",
    en.sectionG,
    ruleTitle("TS-G-001", "en", null),
    requestSentences(result, deadline, "en", { deadline: en.sectionGDeadline, request: en.sectionGRequest }),
  );
  if (!shaped || !english) return report;
  return appendFinding(report, {
    ruleId: shaped.ruleId,
    title: shaped.title ?? undefined,
    severity: shaped.severity,
    verdict: shaped.verdict,
    explanation: shaped.explanation,
    explanationEn: english.explanation,
    method: shaped.method ?? undefined,
    citation: shaped.citation ?? undefined,
  });
}
