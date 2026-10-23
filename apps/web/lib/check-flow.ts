import type { DocumentInsight, DocumentKind, Jurisdiction, StartAnalysis } from "@yomizaka/core";

import { isPhotoFile } from "@/components/console/upload";

/* Pure (no database, no clock): the client reads it too. The check flow of the UX review's Y4. */

/** The kinds a compliance check reads. */
export type CheckableKind = "lease" | "invoice" | "contract";
const CHECKABLE: readonly CheckableKind[] = ["lease", "invoice", "contract"];
const checkable = (kind: string): kind is CheckableKind => (CHECKABLE as readonly string[]).includes(kind);

/** Québec's named rulesets: an invoice and a contract are checked by name, in Québec only (the Studio takes them so). */
const NAMED: Partial<Record<CheckableKind, "qc-invoice" | "qc-service-contract">> = { invoice: "qc-invoice", contract: "qc-service-contract" };

/** The rules a kind is checked against: a lease by its jurisdiction, an invoice and a contract by Québec's named rulesets — never a jurisdiction left over from another kind (the review's C5). */
export function rulesFor(kind: CheckableKind, jurisdiction: Jurisdiction = "QC", asOf?: string): StartAnalysis {
  const ruleset = NAMED[kind];
  return { studio: "compliance-check", jurisdiction: ruleset ? "QC" : jurisdiction, ...(ruleset ? { ruleset } : {}), ...(asOf ? { asOf } : {}) };
}

type Understanding = Pick<DocumentInsight["understanding"], "nature" | "check">;

/**
 * What happens once a file landed (the review's C4, decided by the CTO): the check starts at once when the kind is sure — the
 * person named it, or Yomizaka recognised it with high confidence — and the page opens on the report; otherwise the report
 * tab opens with one confirmation to give (the kind, its rules). Another kind of document has no compliance rules: confirm.
 */
export function afterUpload({ requested, insight, jurisdictions = ["QC"] }: { requested: DocumentKind | "auto"; insight: Understanding | null; jurisdictions?: readonly Jurisdiction[] }): { start: StartAnalysis | null; confirm: boolean; tab: "verifications" } {
  const tab = "verifications" as const;
  const recognised = insight?.check ?? null;
  const sure = insight?.nature?.confidence === "high";
  const kind = checkable(requested) ? requested : requested === "auto" && recognised && sure ? recognised.documentType : null;
  if (!kind) return { start: null, confirm: true, tab };
  // A lease's rules are its jurisdiction's: established only when the person is offered one; several, and the report tab asks.
  if (kind === "lease" && jurisdictions.length !== 1) return { start: null, confirm: true, tab };
  return { start: rulesFor(kind, jurisdictions[0]), confirm: false, tab };
}

/** The checking options (keep the document, photos as pages) are asked once the files are known, never before (the review's B4). */
export const optionsShown = (files: readonly { name: string }[]): boolean => files.length > 0;

/** « These photos are the pages of one document » makes sense with two photos or more, and nothing else in the drop (the review's C3). */
export const groupingOffered = (files: readonly { name: string; type?: string }[]): boolean => files.length >= 2 && files.every(isPhotoFile);
