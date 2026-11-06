import { refuse } from "./http";

/*
 * The applicant file's rules (verikora#127), pure: the link's states, what a request may ask, the document-type catalogue's
 * seed and the retention a document gets. The database rows (lib/config-seed.ts) are the source of truth; this module
 * decides on them without touching the database.
 */

/** The purposes a consent is given for. Here, with the pure rules, so the applicant's page (a client component) reads them without the database. */
export const CONSENT_PURPOSE = {
  DOCUMENT_CHECK: "DOCUMENT_CHECK",
  COURT_RECORDS: "COURT_RECORDS",
  CREDIT: "CREDIT",
  DOCUMENT_KEEP: "DOCUMENT_KEEP",
} as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSE)[keyof typeof CONSENT_PURPOSE];

/** The application status once erased (its personal fields are gone). Here, not in applicant-consent (which reads the database), so the browser can read the rules. */
export const APPLICATION_ERASED = "erased" as const;

/** The link of an applicant file: open, or refused for one reason. Erasure of the application is its own state. */
export const LINK = {
  open: "open",
  revoked: "revoked",
  expired: "expired",
  used: "used",
  closed: "closed",
  erased: "erased",
} as const;
export type LinkState = (typeof LINK)[keyof typeof LINK];

export interface LinkRow {
  status: string;
  expires_at: Date;
  revoked_at: Date | null;
  submitted_at: Date | null;
  closed_at: Date | null;
}

/** The state of a link as of now. Pure: the clock is passed in. A closed or erased file is refused before anything else. */
export function linkState(row: LinkRow, now: Date): LinkState {
  if (row.status === APPLICATION_ERASED) return LINK.erased;
  if (row.closed_at) return LINK.closed;
  if (row.revoked_at) return LINK.revoked;
  if (row.expires_at.getTime() <= now.getTime()) return LINK.expired;
  if (row.submitted_at) return LINK.used;
  return LINK.open;
}

const REFUSALS: Record<Exclude<LinkState, "open">, { status: number; code: string; message: string }> = {
  revoked: { status: 410, code: "LINK_REVOKED", message: "This link was revoked" },
  expired: { status: 410, code: "LINK_EXPIRED", message: "This link expired" },
  used: { status: 409, code: "LINK_USED", message: "This file was already sent" },
  closed: { status: 410, code: "FILE_CLOSED", message: "This file was closed" },
  erased: { status: 410, code: "APPLICATION_ERASED", message: "This application was erased" },
};

/** Refuses an action on a link that is not open (uploads and the submission; a withdrawal or an erasure is always allowed). */
export function assertOpen(state: LinkState): void {
  if (state === LINK.open) return;
  const refusal = REFUSALS[state];
  throw refuse(refusal.status, refusal.code, refusal.message);
}

/**
 * Documents a request never asks for, whatever the catalogue holds: they are not needed for the check (Loi 25
 * minimisation; the Charter limits what a landlord may require). Their codes are refused by the request.
 */
export const NOT_NECESSARY_TYPES: readonly string[] = [
  "sin",
  "health-card",
  "passport",
  "driver-licence",
  "void-cheque",
  "bank-details",
];

/** A document of a file, at most: a bound on what one application can hold (a fixed value, not a business parameter). */
// @fixed: a rental file needs a handful of documents; twelve covers several pay stubs and statements with room to spare.
export const MAX_DOCUMENTS_PER_FILE = 12;

/** The jurisdiction the applicant documents are checked against: the Québec rules the firm operates under. */
// @fixed: the buildings are in Québec; the compliance Studio reads the Québec ruleset.
export const FILE_JURISDICTION = "QC" as const;

/** The types a request asks for: at least one, no repeats, none on the minimisation list, all known to the catalogue. Pure. */
export function requestedTypes(asked: readonly string[], catalogue: readonly string[]): string[] {
  const unique = [...new Set(asked)];
  if (unique.length === 0) throw refuse(400, "BAD_REQUEST", "Ask for at least one document");
  const notNecessary = unique.find((t) => NOT_NECESSARY_TYPES.includes(t));
  if (notNecessary)
    throw refuse(422, "TYPE_NOT_NECESSARY", "This document is not necessary for the check and cannot be asked for", {
      type: notNecessary,
    });
  const unknown = unique.find((t) => !catalogue.includes(t));
  if (unknown) throw refuse(422, "TYPE_UNKNOWN", "No such document type", { type: unknown });
  return unique;
}

export type RetentionPolicy = "after-check" | "after-decision";

/**
 * The retention a document gets. By default it is purged once its checks have run. It is kept until the manager's decision
 * only when the applicant consented to keep it AND the type allows that (a type kept « after-check » is never kept). Pure.
 */
export function retentionOf(typePolicy: string, keepConsent: boolean): RetentionPolicy {
  return keepConsent && typePolicy === "after-decision" ? "after-decision" : "after-check";
}

/** The catalogue's seed, as the migration 0031 inserts it: the document types, the studios each one runs, and the fields read. */
export const SEED_DOCUMENT_TYPES = ["pay-stub", "bank-statement", "employment-letter", "identity-document"] as const;

/** The fields a document type asks for, by key (the words are messages). Never a SIN, a health or a bank-account field. */
export const SEED_FIELDS: Record<(typeof SEED_DOCUMENT_TYPES)[number], readonly string[]> = {
  "pay-stub": ["employer", "pay-period"],
  "bank-statement": ["statement-period"],
  "employment-letter": ["employer", "position", "start-date"],
  "identity-document": ["full-name"],
};

/** Whether a field key is one the minimisation refuses: an identifier, a health, a passport, a licence or a bank field. */
export const isRefusedField = (key: string): boolean =>
  /(^|[-_])(sin|nas|health|passport|licen[cs]e|bank|account|iban|void)/i.test(key);
