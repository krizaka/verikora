import { type Audience, type DocumentKind, type Studio } from "@verikora/core";

/* Pure (no database): the client reads it too. */

/**
 * The check a document page offers first. A landlord's « other » documents are the tenant's papers (identity, proof of
 * income): the file itself is what is questioned, so the authenticity check comes first. Everything else — a lease, a
 * contract, an invoice, and every tenant's document — starts with the compliance check.
 */
export function firstCheck(perspective: Audience | null, kind: DocumentKind): Studio {
  // Freelancers and businesses have no compliance rules yet (« bientôt »): what runs for them today is the file's examination.
  if (perspective === "freelancer" || perspective === "business") return "document-authenticity";
  return perspective === "landlord" && kind === "other" ? "document-authenticity" : "compliance-check";
}

/** The key of the wording a person reads: their side, or the neutral text before they chose. */
export const wordingOf = (perspective: Audience | null): Audience | "neutral" => perspective ?? "neutral";
