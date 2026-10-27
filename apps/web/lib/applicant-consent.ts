import { APPLICATION_ERASED, CONSENT_PURPOSE, type ConsentPurpose } from "./applicant-file-rules";
import { audit } from "./audit";
import { query } from "./db";
import { deleteDocument, isUuid } from "./documents";
import { refuse } from "./http";
import type { DocumentStore } from "./storage/port";

/*
 * The applicant's consent (yomizaka#131, Loi 25). The subject is the APPLICATION (a screening row, one per applicant and
 * landlord request); consent is recorded per purpose, with the notice version the applicant was shown, the date and the
 * means. Withdrawal stops further checks; erasure deletes what was kept. The purposes are the engine's external-check
 * purposes (orazaka-ai-engine `CheckPurpose`: COURT_RECORDS, CREDIT) plus DOCUMENT_CHECK, the analysis of the document itself,
 * and DOCUMENT_KEEP, the keeping of the applicant file's documents until the manager's decision (yomizaka#127).
 */

export { CONSENT_PURPOSE, type ConsentPurpose };
export const CONSENT_PURPOSES = Object.values(CONSENT_PURPOSE) as ConsentPurpose[];

/** The version of the notice (messages `applicant.notice`). Changing the text changes this, and a consent to an old one is refused. */
export const NOTICE_VERSION = "2026-10-24.2";
/** The application status once erased: defined with the file's pure rules, which the browser reads too. */
export { APPLICATION_ERASED };
/** How consent was given: the applicant's own form, on the link they received. */
export const CONSENT_MEANS = { WEB_FORM: "web-form" } as const;

/** The consent purposes a set of check types needs: each type names the engine purpose it runs under (data, yomizaka#132). */
export const purposesOfTypes = (types: readonly { purpose: string }[]): ConsentPurpose[] => [...new Set(types.map((t) => t.purpose).filter((p): p is ConsentPurpose => p === CONSENT_PURPOSE.COURT_RECORDS || p === CONSENT_PURPOSE.CREDIT))];

/** Pure: is a purpose granted in a list of active purposes? */
export const hasConsent = (active: readonly string[], purpose: ConsentPurpose): boolean => active.includes(purpose);

/** Refuses the purpose unless the application has an active consent for it. Enforced in the services, never only in a route. */
export async function requireConsent(screeningId: string, purpose: ConsentPurpose): Promise<void> {
  const [row] = await query("SELECT 1 FROM application_consents WHERE screening_id = $1 AND purpose = $2 AND withdrawn_at IS NULL", [screeningId, purpose]);
  if (!row) throw refuse(403, "CONSENT_REQUIRED", "The applicant has not consented to this purpose", { purpose });
}

/** The purposes an application has active right now. */
export async function activeConsents(screeningId: string): Promise<ConsentPurpose[]> {
  const rows = await query<{ purpose: ConsentPurpose }>("SELECT purpose FROM application_consents WHERE screening_id = $1 AND withdrawn_at IS NULL", [screeningId]);
  return rows.map((r) => r.purpose);
}

/** Records a consent. The notice version must be the current one; a repeat of an active consent changes nothing. */
export async function grantConsent(screeningId: string, purpose: ConsentPurpose, input: { noticeVersion: string; means: string }, now: Date, headers?: Headers): Promise<boolean> {
  if (input.noticeVersion !== NOTICE_VERSION) throw refuse(409, "NOTICE_CHANGED", "The notice changed: read it again before consenting", { noticeVersion: NOTICE_VERSION });
  const rows = await query<{ id: string }>(
    "INSERT INTO application_consents (screening_id, purpose, notice_version, means, granted_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (screening_id, purpose) WHERE withdrawn_at IS NULL DO NOTHING RETURNING id",
    [screeningId, purpose, input.noticeVersion, input.means, now],
  );
  if (rows.length) await audit({ action: "consent.granted", actorId: null, actorLabel: "applicant", targetId: screeningId, detail: { purpose, noticeVersion: input.noticeVersion, means: input.means }, headers });
  return rows.length > 0;
}

/**
 * Withdraws a consent: no further check of that purpose runs. A pending request is declined and a result already held for it
 * is deleted (for the check purposes); a document purpose only stops its analyses.
 */
export async function withdrawConsent(screeningId: string, purpose: ConsentPurpose, now: Date, headers?: Headers): Promise<boolean> {
  const rows = await query<{ id: string }>("UPDATE application_consents SET withdrawn_at = $3 WHERE screening_id = $1 AND purpose = $2 AND withdrawn_at IS NULL RETURNING id", [screeningId, purpose, now]);
  if (!rows.length) return false;
  // Only the check purposes decline a pending request or delete a held result; the document purposes stop their analyses only.
  if (purpose === CONSENT_PURPOSE.COURT_RECORDS || purpose === CONSENT_PURPOSE.CREDIT) {
    await query("UPDATE screenings SET status = 'declined' WHERE id = $1 AND status = 'requested'", [screeningId]);
    await query("UPDATE screenings SET result = NULL, result_expires_at = NULL, contest_comment = NULL, purged_at = $2 WHERE id = $1 AND result IS NOT NULL", [screeningId, now]);
    await query("DELETE FROM screening_checks WHERE screening_id = $1", [screeningId]);
  }
  await audit({ action: "consent.withdrawn", actorId: null, actorLabel: "applicant", targetId: screeningId, detail: { purpose }, headers });
  return true;
}

/**
 * The upload gate: a document for an application is accepted only from the landlord who asked for it, and only with the
 * DOCUMENT_CHECK consent. Refused before any byte is stored.
 */
export async function assertUploadForApplication(ownerId: string, screeningId: string): Promise<void> {
  if (!isUuid(screeningId)) throw refuse(404, "NOT_FOUND", "No such application");
  const [app] = await query<{ landlord_id: string; status: string }>("SELECT landlord_id, status FROM screenings WHERE id = $1", [screeningId]);
  if (app?.landlord_id !== ownerId) throw refuse(404, "NOT_FOUND", "No such application");
  if (app.status === APPLICATION_ERASED) throw refuse(410, "APPLICATION_ERASED", "This application was erased");
  await requireConsent(screeningId, CONSENT_PURPOSE.DOCUMENT_CHECK);
}

/** Links an uploaded document to its application, then re-checks the consent: a withdrawal during the upload deletes it. */
export async function attachToApplication(ownerId: string, documentId: string, screeningId: string, store?: DocumentStore): Promise<void> {
  await query("UPDATE documents SET screening_id = $3 WHERE id = $1 AND owner_id = $2", [documentId, ownerId, screeningId]);
  try {
    await requireConsent(screeningId, CONSENT_PURPOSE.DOCUMENT_CHECK);
  } catch (error) {
    await deleteDocument(ownerId, documentId, store);
    throw error;
  }
}

/** The analysis gate: a document of an application runs a check only while its DOCUMENT_CHECK consent stands. */
export async function assertAnalysisAllowed(screeningId: string | null): Promise<void> {
  if (screeningId) await requireConsent(screeningId, CONSENT_PURPOSE.DOCUMENT_CHECK);
}

/**
 * Erasure, asked by the applicant: every document of the application and its reports are deleted now, the consents are
 * withdrawn, and the application keeps no personal field (name, e-mail, result). The audit line names no one.
 */
export async function eraseApplication(screeningId: string, ownerId: string, store: DocumentStore | undefined, now: Date, headers?: Headers): Promise<{ documents: number }> {
  const docs = await query<{ id: string }>("SELECT id FROM documents WHERE screening_id = $1 AND owner_id = $2", [screeningId, ownerId]);
  for (const d of docs) await deleteDocument(ownerId, d.id, store);
  await query("UPDATE application_consents SET withdrawn_at = $2 WHERE screening_id = $1 AND withdrawn_at IS NULL", [screeningId, now]);
  await query(
    "UPDATE screenings SET status = 'erased', tenant_name = '', tenant_email = $2, result = NULL, result_expires_at = NULL, contest_comment = NULL, purged_at = $3 WHERE id = $1 AND status <> 'erased'",
    [screeningId, `erased+${screeningId}@erased.invalid`, now],
  );
  await query("DELETE FROM screening_checks WHERE screening_id = $1", [screeningId]);
  await audit({ action: "applicant.erased", actorId: null, actorLabel: "applicant", targetId: screeningId, detail: { documents: docs.length }, headers });
  return { documents: docs.length };
}
