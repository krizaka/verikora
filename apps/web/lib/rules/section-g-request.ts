import type { SectionGResult } from "./section-g";
import type { SectionGDeadline } from "./section-g-deadline";

/**
 * The facts for a request to the TAL to fix the rent (verikora#566, slice 5 of #104: the « filing template » of the epic, as a summary
 * of facts the tenant keeps and carries to the TAL, never a filing: Verikora files nothing). Pure: it lays out what Section G (#554) and
 * the deadline (#562) already found, in a stable order, as message keys with their figures (cents; the view formats them). It names no
 * form and no fee: the TAL's page « Avis au nouveau locataire » does not link the recourse to a form, so the tenant is pointed to the TAL.
 * No finding, no summary. Information, not legal advice. LAWYER REVIEW: see docs/compliance-gate.md.
 */
export type RequestLineKey =
  "rentNew" | "rentPrevious" | "previousBlank" | "previousAltered" | "rentMax" | "excess" | "deadline";

export interface RequestLine {
  key: RequestLineKey;
  values: Record<string, string | number>;
}

export interface SectionGRequestSummary {
  status: "ready" | "no-claim";
  citation: string | null;
  lines: RequestLine[];
}

const ASKS_FOR_A_LOOK: ReadonlySet<string> = new Set(["finding"]);
const NONE: SectionGRequestSummary = { status: "no-claim", citation: null, lines: [] };

export function sectionGRequestSummary(section: SectionGResult, deadline: SectionGDeadline): SectionGRequestSummary {
  if (!ASKS_FOR_A_LOOK.has(section.status) || !section.recourse) return NONE;
  const { figures } = section;
  const lines: RequestLine[] = [{ key: "rentNew", values: { cents: figures.newRentCents } }];
  switch (section.code) {
    case "previous-blank":
      lines.push({ key: "previousBlank", values: {} });
      break;
    case "previous-altered":
      lines.push({ key: "previousAltered", values: {} });
      break;
    default:
      if (figures.previousRentCents !== undefined)
        lines.push({ key: "rentPrevious", values: { cents: figures.previousRentCents } });
      if (figures.maxRentCents !== undefined)
        lines.push({ key: "rentMax", values: { cents: figures.maxRentCents, year: section.source.year ?? 0 } });
      if (figures.excessCents !== undefined) lines.push({ key: "excess", values: { cents: figures.excessCents } });
  }
  if (deadline.lastDay) lines.push({ key: "deadline", values: { lastDay: deadline.lastDay, state: deadline.state } });
  return { status: "ready", citation: section.recourse.citation, lines };
}
