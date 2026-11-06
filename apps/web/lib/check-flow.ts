import type { DocumentInsight, DocumentKind, Jurisdiction, StartAnalysis } from "@verikora/core";

import { isPhotoFile } from "@/components/console/upload";

import { type CheckKind, isCheckKind, rulesetFor } from "./rulesets";

/* Pure (no database, no clock): the client reads it too. The check flow of the UX review's Y4 and the identify stage of ADR-089:
 * the declared kind and the detected one select the ruleset; a mismatch is shown and never starts a run by itself. */

export type CheckableKind = CheckKind;

/** The request that starts a check of `kind` on `asOf`, or null when no ruleset is in force for it: never another kind's rules. */
export function rulesFor(kind: CheckKind, jurisdiction: Jurisdiction = "QC", asOf: string): StartAnalysis | null {
  const choice = rulesetFor(kind, jurisdiction, asOf);
  if (!choice.verified) {
    return null;
  }
  return {
    studio: "compliance-check",
    jurisdiction: kind === "lease" ? jurisdiction : "QC",
    ...(choice.ruleset ? { ruleset: choice.ruleset } : {}),
    asOf,
  };
}

type Understanding = Pick<DocumentInsight["understanding"], "nature" | "check">;

export interface CheckPlan {
  /** The request to start, or null: nothing runs until the person confirms. */
  start: StartAnalysis | null;
  confirm: boolean;
  tab: "verifications";
  /** The declared kind and the detected one differ: shown; the declared one is the default until the person confirms. */
  mismatch: { declared: DocumentKind; detected: CheckKind } | null;
  /** No ruleset is in force for the kind: said plainly (« pas encore vérifié contre la loi »), never judged as a lease. */
  unsupported: boolean;
}

/**
 * The plan of a check. The declared kind (« Quel document ? », or `auto`) and the detected kind select the ruleset; a mismatch
 * never starts a run by itself (the declared kind is the default until the person confirms); an unsupported kind says so.
 */
export function planCheck({
  declared,
  detected,
  jurisdictions = ["QC"],
  asOf,
}: {
  declared: DocumentKind | "auto";
  detected: CheckKind | null;
  jurisdictions?: readonly Jurisdiction[];
  asOf: string;
}): CheckPlan {
  const tab = "verifications" as const;
  if (declared !== "auto" && detected && detected !== declared) {
    return { start: null, confirm: true, tab, mismatch: { declared, detected }, unsupported: false };
  }
  const kind: string | null = declared === "auto" ? detected : declared;
  if (!kind) {
    return { start: null, confirm: true, tab, mismatch: null, unsupported: false };
  }
  if (!isCheckKind(kind)) {
    return { start: null, confirm: true, tab, mismatch: null, unsupported: true };
  }
  // A lease's rules are its jurisdiction's: established only when the person is offered one; several, and the report tab asks.
  if (kind === "lease" && jurisdictions.length !== 1) {
    return { start: null, confirm: true, tab, mismatch: null, unsupported: false };
  }
  const start = rulesFor(kind, jurisdictions[0], asOf);
  return start
    ? { start, confirm: false, tab, mismatch: null, unsupported: false }
    : { start: null, confirm: true, tab, mismatch: null, unsupported: true };
}

/**
 * What happens once a file landed (the review's C4, decided by the CTO): the check starts at once when the kind is sure — the
 * person named it, or Verikora recognised it with high confidence — and the page opens on the report; otherwise the report
 * tab opens with one confirmation to give (the kind, its rules).
 */
export function afterUpload({
  requested,
  insight,
  jurisdictions = ["QC"],
  asOf,
}: {
  requested: DocumentKind | "auto";
  insight: Understanding | null;
  jurisdictions?: readonly Jurisdiction[];
  asOf: string;
}): CheckPlan {
  const recognised = insight?.check?.documentType ?? null;
  const sure = insight?.nature?.confidence === "high";
  const confirmed = sure ? recognised : null;
  return planCheck({
    declared: requested,
    detected: requested === "auto" ? confirmed : recognised,
    jurisdictions,
    asOf,
  });
}

/** The checking options (keep the document, photos as pages) are asked once the files are known, never before (the review's B4). */
export const optionsShown = (files: readonly { name: string }[]): boolean => files.length > 0;

/**
 * The keep choice is read when a file leaves, which is when it is dropped. Asked after the drop (the library's options), a tick
 * cannot reach the files already sent: it is said to apply to the next ones. « Vérifier un document » asks before the drop.
 */
export const keepAppliesToNext = (files: readonly { name: string }[], defaultsFirst: boolean): boolean =>
  !defaultsFirst && files.length > 0;

/** « These photos are the pages of one document » makes sense with two photos or more, and nothing else in the drop (the review's C3). */
export const groupingOffered = (files: readonly { name: string; type?: string }[]): boolean =>
  files.length >= 2 && files.every(isPhotoFile);
