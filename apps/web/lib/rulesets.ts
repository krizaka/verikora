import type { Jurisdiction } from "@verikora/core";

/* Pure (no database, no clock): the client reads it too. Which ruleset a kind of document is checked against, and which version
 * of it is in force on the check's date (ADR-089: the kind selects the rules, the date selects the version). */

/** The kinds a compliance check can read. A declared kind (« Quel document ? ») is narrower: lease, invoice, contract, other. */
export const CHECK_KINDS = ["lease", "invoice", "contract", "visit-notice", "premises-condition"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export const isCheckKind = (value: string): value is CheckKind => (CHECK_KINDS as readonly string[]).includes(value);

/** The calendar of the law: a check is dated on the day in Québec (Montréal), never on the UTC day (verikora#309). */
export const LAW_TIME_ZONE = "America/Toronto";

/** A version of a ruleset: in force from `effectiveFrom` (null: from the start), and the reference the Studio is asked for. */
export interface RulesetVersion {
  effectiveFrom: string | null;
  ref: string;
}

/**
 * The Québec rulesets, by kind, with their dated versions (sovkora-packs `document-validation`). The lease has two versions
 * (2024-02-21, then 2026-10-24); the visit notice and the état des lieux come into force with the same release (2026-10-24).
 */
const QC_RULESETS: Partial<Record<CheckKind, readonly RulesetVersion[]>> = {
  lease: [
    { effectiveFrom: null, ref: "qc-residential-lease/2024-02-21" },
    { effectiveFrom: "2026-10-24", ref: "qc-residential-lease/2026-10-24" },
  ],
  invoice: [{ effectiveFrom: null, ref: "qc-invoice" }],
  contract: [{ effectiveFrom: null, ref: "qc-service-contract" }],
  "visit-notice": [{ effectiveFrom: "2026-10-24", ref: "qc-visit-notice" }],
  "premises-condition": [{ effectiveFrom: "2026-10-24", ref: "qc-premises-condition" }],
};

/** The version in force on `asOf` (ISO yyyy-mm-dd): the latest one that has come into force by then, or none. */
export function versionInForce(versions: readonly RulesetVersion[], asOf: string): RulesetVersion | null {
  let current: RulesetVersion | null = null;
  for (const version of versions) {
    if (
      (version.effectiveFrom === null || version.effectiveFrom <= asOf) &&
      (current === null || (version.effectiveFrom ?? "") >= (current.effectiveFrom ?? ""))
    )
      current = version;
  }
  return current;
}

/**
 * The ruleset a kind is checked against on a date. `verified: false` means no ruleset is in force for that kind, in that
 * jurisdiction, on that date: the check says so and never falls back to another kind's rules (a visit notice is never a lease).
 * `ruleset: null` with `verified: true` is a jurisdiction's own lease (France, Wallonia): its default, named by no request.
 */
export type RulesetChoice = { verified: true; ruleset: string | null } | { verified: false };

export function rulesetFor(kind: CheckKind, jurisdiction: Jurisdiction, asOf: string): RulesetChoice {
  // Only a lease follows the jurisdiction; the named Québec rulesets are Québec's alone.
  if (kind === "lease" && jurisdiction !== "QC") return { verified: true, ruleset: null };
  const versions = QC_RULESETS[kind];
  const version = versions ? versionInForce(versions, asOf) : null;
  return version ? { verified: true, ruleset: version.ref } : { verified: false };
}
