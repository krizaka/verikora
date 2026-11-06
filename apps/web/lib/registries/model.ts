/*
 * The public registers about BUSINESSES, behind one port (ADR-0014, verikora#627). Only the number printed on a document is looked up,
 * never a person's name. An answer is a fact about the register ("not found", "revoked on …"), never a verdict on a document; a register
 * that cannot answer says so ("not looked up") and raises nothing.
 */
export const NOT_LOOKED_UP = {
  badFormat: "bad-format",
  unavailable: "unavailable",
  notAuthorised: "not-authorised",
  notCovered: "not-covered",
} as const;
export type NotLookedUpReason = (typeof NOT_LOOKED_UP)[keyof typeof NOT_LOOKED_UP];

/** What a register says of a business: its status and the date it took effect, and the names it holds (empty when the register gave none). */
export interface RegisteredBusiness {
  /** "registered" (in good standing) or "struck" (revoked or cancelled). */
  status: "registered" | "struck";
  statusDate: string | null;
  legalName: string | null;
  tradeName: string | null;
}

export const ANSWER = { found: "found", unknown: "unknown", notLookedUp: "not-looked-up" } as const;
export const FOUND_STATUS = { registered: "registered", struck: "struck" } as const;

export type RegistryAnswer =
  ({ kind: "found" } & RegisteredBusiness) | { kind: "unknown" } | { kind: "not-looked-up"; reason: NotLookedUpReason };

export interface BusinessRegistry {
  /** The register's own name, as the report shows its source. */
  readonly source: string;
  /** Looks up a QST number as printed on a document. Never throws: a failure is `not-looked-up`. */
  lookupQst(printedNumber: string): Promise<RegistryAnswer>;
}

/** A register that is not used: honest, it looks nothing up (CRA's GST/HST registry is forbidden for automated use; the REQ waits for its authorisation). */
export const closedRegistry = (source: string, reason: NotLookedUpReason): BusinessRegistry => ({
  source,
  lookupQst: async () => ({ kind: ANSWER.notLookedUp, reason }),
});
