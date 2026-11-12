import type { DocumentStatus } from "@verikora/core";

import type { FileSummary } from "./applicant-file";
import { LINK } from "./applicant-file-rules";
import type { CheckSummary } from "./checks";

/**
 * « À traiter » and « Dernières vérifications » of the home (krizaka-internal#2290, spec krizaka-restricted#220): what waits for the
 * manager's decision, and the checks that ran last. Pure, over the rows the home already reads (the applicant files, the newest
 * checks): nothing is counted aside, so a row here is a row of « Dossiers » or « Vérifications ».
 */

/** The most rows each of the two sections lists. */
// @fixed: a glanceable list on the home; the rest is one tap away in Dossiers and Vérifications
export const HOME_ROWS = 5;

/** The checks the manager has to look at: the same states Vérifications lists under « To look at » (a failed run or a report asking for attention). */
const NEEDS_A_LOOK: readonly DocumentStatus[] = ["attention", "failed"];

export type ToTreatRow =
  | { kind: "file"; id: string; name: string; at: string; href: string }
  | {
      kind: "check";
      id: string;
      name: string;
      studio: CheckSummary["studio"];
      result: DocumentStatus;
      at: string;
      href: string;
    };

export const reportHref = (locale: "en" | "fr", c: Pick<CheckSummary, "documentId">) =>
  `/${locale}/app/documents/${c.documentId}/rapport`;

/** Files the candidate sent and nobody decided, and checks to look at, the most recent first, five at most. */
export function toTreatOf(
  files: readonly FileSummary[],
  checks: readonly CheckSummary[],
  locale: "en" | "fr",
): ToTreatRow[] {
  const rows: ToTreatRow[] = [
    ...files
      .filter((f) => f.status === LINK.used)
      .map((f) => ({
        kind: "file" as const,
        id: f.id,
        name: f.candidateName,
        at: f.submittedAt ?? f.createdAt,
        href: `/${locale}/app/dossiers/${f.id}`,
      })),
    ...checks
      .filter((c) => NEEDS_A_LOOK.includes(c.result))
      .map((c) => ({
        kind: "check" as const,
        id: c.id,
        name: c.title,
        studio: c.studio,
        result: c.result,
        at: c.at,
        href: reportHref(locale, c),
      })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, HOME_ROWS);
}

/** The last checks, newest first (the list is already in that order; sorted again so the section never depends on it). */
export const latestChecksOf = (checks: readonly CheckSummary[]): CheckSummary[] =>
  [...checks].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, HOME_ROWS);
