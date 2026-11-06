import type { DocumentKind, DocumentSummary, StartAnalysis } from "@verikora/core";

/** The rules each kind of document is checked against: a lease has the jurisdiction's own, the others a named Québec ruleset. */
const RULESET_OF_KIND: Record<DocumentKind, "qc-invoice" | "qc-service-contract" | undefined> = {
  lease: undefined,
  contract: "qc-service-contract",
  invoice: "qc-invoice",
  other: undefined,
};

/** The declared kind with no ruleset in force (« Autre »): no compliance check is offered for it. */
const UNVERIFIED_KIND: DocumentKind = "other";

export const CHECK = { compliance: "compliance-check", authenticity: "document-authenticity" } as const;

/**
 * What a document can be checked for, best first. The compliance check reads the text, so a scan with no text layer
 * only gets the authenticity check (the web says the same); reading images is the engine's job, not the phone's.
 */
export function availableChecks(doc: Pick<DocumentSummary, "kind" | "hasText" | "mimeType">): StartAnalysis[] {
  const ruleset = RULESET_OF_KIND[doc.kind];
  const compliance: StartAnalysis = { studio: CHECK.compliance, jurisdiction: "QC", ...(ruleset ? { ruleset } : {}) };
  const authenticity: StartAnalysis = { studio: CHECK.authenticity };
  // Another kind has no ruleset in force: the lease's rules are never its fallback (ADR-089), so no compliance check is offered.
  const verifiable = doc.kind !== UNVERIFIED_KIND;
  return [
    ...(doc.hasText && verifiable ? [compliance] : []),
    ...(doc.mimeType === "application/pdf" ? [authenticity] : []),
  ];
}
