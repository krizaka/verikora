import { money } from "../prices/format";
import { type SectionGResult } from "./section-g";

/**
 * Section G's result in the report's finding format (`lib/report.ts`, the `payloadFinding` shape), so it reads and signs like any other
 * finding of the check. A `finding` fails, an `ok` passes, a `no-claim` is not a finding at all (it says nothing, for want of data).
 * The explanation is the message of `sectionG.<code>`, the recourse sentence follows only a finding, the disclaimer always ends it.
 */
export interface SectionGMessages {
  [code: string]: string;
  recourse: string;
  disclaimer: string;
}

export interface ReportFindingShape {
  ruleId: string;
  title: string | null;
  severity: string;
  verdict: string;
  citation: string | null;
  quote: string | null;
  explanation: string;
  method: string | null;
}

/** A finding fails, an ok passes, a no-claim is not a finding. */
const VERDICT: Record<SectionGResult["status"], string | null> = { finding: "FAIL", ok: "PASS", "no-claim": null };

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export function sectionGFinding(result: SectionGResult, lang: "en" | "fr", messages: SectionGMessages, title: string): ReportFindingShape | null {
  const verdict = VERDICT[result.status];
  if (!verdict) return null;
  const vars = {
    year: result.source.year ?? "",
    max: result.figures.maxRentCents === undefined ? "" : money(result.figures.maxRentCents, lang),
    excess: result.figures.excessCents === undefined ? "" : money(result.figures.excessCents, lang),
    source: result.source.url,
  };
  const parts = [fill(messages[result.code] ?? "", vars)];
  if (result.recourse) parts.push(messages.recourse);
  parts.push(messages.disclaimer);
  return {
    ruleId: result.ruleId,
    title,
    severity: "MAJOR",
    verdict,
    citation: result.citations.join(" ; ") || null,
    quote: null,
    explanation: parts.join(" "),
    method: "DETERMINISTIC",
  };
}
