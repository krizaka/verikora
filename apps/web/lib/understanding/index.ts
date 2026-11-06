import { createUnderstanding } from "./extract";
import { DOCUMENT_TYPES, IDENTIFIERS, PARTY_ROLES } from "./types";

export { createUnderstanding } from "./extract";
export type * from "./port";

/** Verikora's understanding: its document types and identifiers (data), with the thresholds of its own judgement. */
export const understanding = createUnderstanding({
  types: DOCUMENT_TYPES,
  identifiers: IDENTIFIERS,
  partyRoles: PARTY_ROLES,
  thresholds: { high: 6, medium: 3, low: 1 },
  alternativeShare: 0.6,
});
