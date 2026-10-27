import { filterSql, type StatusSet, type ViewFilters } from "@krizaka/organize";
import type { Analysis, StartAnalysis, StorageKind,Studio } from "@yomizaka/core";

import { refresh, startAnalysis } from "./analyses";
import { activeConsents, assertUploadForApplication, attachToApplication, CONSENT_PURPOSE, type ConsentPurpose, hasConsent } from "./applicant-consent";
import { assertOpen, FILE_JURISDICTION, type LinkState, linkState, MAX_DOCUMENTS_PER_FILE, requestedTypes, retentionOf } from "./applicant-file-rules";
import { audit } from "./audit";
import { releaseAudit,reserveAudit } from "./billing";
import { query, withBlockingLock } from "./db";
import { type AnalysisRow, inspectUpload, isUuid, type StoragePolicy, storeDocument } from "./documents";
import { codeOf, HttpError, refuse } from "./http";
import { EXTERNAL, objectKey, purgeIfDone } from "./retention";
import { policyFor } from "./retention-policy";
import { addDays, hash, newToken, REQUEST_VALID_DAYS } from "./screening";
import type { DocumentStore } from "./storage/port";
import { DECISION, KIND, WORKSPACE } from "./workspace/decl";

/*
 * The applicant file (yomizaka#127). A manager asks for a file: a screening row of flow « file » carries the link (its
 * token's hash, 14 days) and the document types asked for. The applicant reads the notice and consents per purpose (#131),
 * then uploads: each document is typed by the catalogue, checked by the document-authenticity and compliance Studios (each
 * an Orazaka run, the trace kept), and purged after its checks unless the applicant consented to keep it until the manager's
 * decision. The file goes to the manager's account only; the link is refused once expired, revoked, used or closed.
 */

type Owner = { id: string; email: string };

/** The auditable shape of a link row (a screening of flow « file »). */
export interface FileRow {
  id: string;
  landlord_id: string;
  tenant_name: string;
  tenant_email: string;
  status: string;
  created_at: Date;
  expires_at: Date;
  requested_types: string[];
  revoked_at: Date | null;
  submitted_at: Date | null;
  closed_at: Date | null;
}

/** What the manager reads of one check that was not run: the studio, and the stable reason (a code the page translates). */
export interface SkippedCheck {
  studio: Studio;
  code: string;
}

/** The catalogue row a document is typed by. */
export interface DocumentType {
  id: string;
  studios: Studio[];
  fields: string[];
  retentionPolicy: string;
  acceptedKinds: string[];
}

interface TypeRow {
  id: string;
  studios: string[];
  fields: string[];
  retention_policy: string;
  accepted_kinds: string[];
}

const toType = (r: TypeRow): DocumentType => ({ id: r.id, studios: r.studios as Studio[], fields: r.fields, retentionPolicy: r.retention_policy, acceptedKinds: r.accepted_kinds });

/** The active document types, in their order: what a request may ask for, and what the applicant is shown. */
export async function documentTypes(): Promise<DocumentType[]> {
  const rows = await query<TypeRow>("SELECT id, studios, fields, retention_policy, accepted_kinds FROM document_types WHERE active ORDER BY position, id");
  return rows.map(toType);
}

async function documentTypeOf(id: string): Promise<DocumentType> {
  const type = (await documentTypes()).find((t) => t.id === id);
  if (!type) throw refuse(422, "TYPE_UNKNOWN", "No such document type", { type: id });
  return type;
}

/** The link's row, by its token: only a file, never a screening (its answers keep their own route). */
export async function fileByToken(token: string): Promise<FileRow> {
  const [row] = await query<FileRow>("SELECT id, landlord_id, tenant_name, tenant_email, status, created_at, expires_at, requested_types, revoked_at, submitted_at, closed_at FROM screenings WHERE token_hash = $1 AND flow = 'file'", [hash(token)]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such link");
  return row;
}

/** A file of the manager's own: another manager's file is « not found », never « forbidden » (no existence leak). */
async function ownedFile(landlordId: string, id: string): Promise<FileRow> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such applicant file");
  const [row] = await query<FileRow>("SELECT id, landlord_id, tenant_name, tenant_email, status, created_at, expires_at, requested_types, revoked_at, submitted_at, closed_at FROM screenings WHERE id = $1 AND landlord_id = $2 AND flow = 'file'", [id, landlordId]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such applicant file");
  return row;
}

/** The manager asks for a file: the documents to send, and the link (returned ONCE; only its hash is kept). */
export async function requestApplicantFile(owner: Owner, input: { candidateName: string; candidateEmail: string; types: string[] }, now: Date, headers?: Headers): Promise<{ id: string; token: string; expiresAt: string }> {
  const types = requestedTypes(input.types, (await documentTypes()).map((t) => t.id));
  const token = newToken();
  const expiresAt = addDays(now, REQUEST_VALID_DAYS);
  const [row] = await query<{ id: string }>(
    "INSERT INTO screenings (landlord_id, tenant_name, tenant_email, scope, provider, token_hash, expires_at, flow, requested_types) VALUES ($1, $2, $3, '{}', 'applicant-file', $4, $5, 'file', $6) RETURNING id",
    [owner.id, input.candidateName.trim(), input.candidateEmail.trim().toLowerCase(), hash(token), expiresAt, types],
  );
  await audit({ action: "applicant_file.requested", actorId: owner.id, actorLabel: owner.email, targetId: row!.id, detail: { types }, headers });
  return { id: row!.id, token, expiresAt: expiresAt.toISOString() };
}

/** What the applicant sees of their file: the link's state, what is asked, and the documents they sent (their names, no results). */
export async function applicantFileState(token: string, now: Date) {
  const row = await fileByToken(token);
  const documents = await query<{ id: string; document_type: string | null; filename: string; size_bytes: number }>(
    "SELECT id, document_type, filename, size_bytes FROM documents WHERE owner_id = $1 AND screening_id = $2 ORDER BY created_at",
    [row.landlord_id, row.id],
  );
  const types = await documentTypes();
  return {
    status: linkState(row, now),
    expiresAt: row.expires_at.toISOString(),
    types: row.requested_types.map((id) => {
      const t = types.find((x) => x.id === id);
      return { id, fields: t?.fields ?? [], retentionPolicy: t?.retentionPolicy ?? "after-check" };
    }),
    documents: documents.map((d) => ({ id: d.id, typeId: d.document_type, filename: d.filename, sizeBytes: d.size_bytes })),
  };
}

/** Upload-time settings the route reads from the owner's account (where documents go, the retention window, the pre-flight). */
export interface UploadContext {
  store: DocumentStore;
  purgeAfterHours: number;
  rules?: NonNullable<StoragePolicy["rules"]>;
  /** The owner's settings allow keeping documents at all (« conserver » is off otherwise, ADR-0007). */
  keepAllowed: boolean;
  auditCaps: Parameters<typeof reserveAudit>[3];
}

export interface UploadFile {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

/** The checks one document runs: each studio of its type is an Orazaka run billed to the manager; one that cannot run is listed. */
async function runChecks(ownerId: string, documentId: string, studios: Studio[], ctx: UploadContext, now: Date): Promise<{ started: Studio[]; skipped: SkippedCheck[] }> {
  const started: Studio[] = [];
  const skipped: SkippedCheck[] = [];
  for (const studio of studios) {
    const request: StartAnalysis = studio === "compliance-check" ? { studio, jurisdiction: FILE_JURISDICTION } : { studio };
    try {
      const via = await reserveAudit(query, ownerId, now, ctx.auditCaps);
      try {
        await startAnalysis(ownerId, documentId, request, null, via, ctx.store);
      } catch (error) {
        await releaseAudit(query, ownerId, via);
        throw error;
      }
      started.push(studio);
    } catch (error) {
      skipped.push({ studio, code: error instanceof HttpError ? codeOf(error, "REFUSED") : "UNAVAILABLE" });
    }
  }
  return { started, skipped };
}

/**
 * The applicant uploads one document of a type the request asked for. The gates run before any byte is stored: the link is
 * open, the type was asked for, the DOCUMENT_CHECK consent stands (a withdrawal during the upload deletes the document), the
 * file is a PDF the type accepts, and the file is not a duplicate. Serialised per application (count, then insert).
 */
export async function uploadApplicantDocument(token: string, typeId: string, file: UploadFile, ctx: UploadContext, now: Date, headers?: Headers) {
  const link = await fileByToken(token);
  assertOpen(linkState(link, now));
  if (!link.requested_types.includes(typeId)) throw refuse(422, "TYPE_NOT_REQUESTED", "This document was not asked for", { type: typeId });
  const type = await documentTypeOf(typeId);
  // The consent to the document check comes first (yomizaka#131): no byte is stored without it.
  await assertUploadForApplication(link.landlord_id, link.id);
  const keepConsent = hasConsent(await activeConsents(link.id), CONSENT_PURPOSE.DOCUMENT_KEEP);
  const retention = retentionOf((await policyFor(link.landlord_id, typeId))?.purgeOn ?? type.retentionPolicy, keepConsent);
  const keep = retention === "after-decision" && ctx.keepAllowed;

  return withBlockingLock(`applicant-file:${link.id}`, async () => {
    const [count] = await query<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE screening_id = $1", [link.id]);
    if ((count?.n ?? 0) >= MAX_DOCUMENTS_PER_FILE) throw refuse(409, "TOO_MANY_DOCUMENTS", "This file holds as many documents as it can");
    const { fileKind } = await inspectUpload({ name: file.name, type: file.type, size: file.size }, file.bytes, ctx.rules);
    if (!type.acceptedKinds.includes(fileKind)) throw refuse(415, "FILE_NOT_ACCEPTED", "This document must be sent as a PDF", { type: typeId });
    const { summary, duplicate } = await storeDocument(link.landlord_id, { name: file.name, type: file.type, size: file.size }, file.bytes, "other", { keep, store: ctx.store, now, purgeAfterHours: ctx.purgeAfterHours, rules: ctx.rules });
    if (duplicate) throw refuse(409, "DUPLICATE_DOCUMENT", "This file was already sent");
    // Linked to the application, then the consent is checked again: a withdrawal during the upload deletes it.
    await attachToApplication(link.landlord_id, summary.id, link.id, ctx.store);
    await query("UPDATE documents SET document_type = $2, retention_policy = $3 WHERE id = $1", [summary.id, typeId, retention]);
    const checks = await runChecks(link.landlord_id, summary.id, type.studios, ctx, now);
    await query("UPDATE documents SET checks_skipped = $2::jsonb WHERE id = $1", [summary.id, JSON.stringify(checks.skipped)]);
    // Not kept and no check is running (every one was skipped): the file goes now. Otherwise it goes when its check ends.
    await purgeIfDone(query, summary.id);
    await audit({ action: "applicant_file.document_uploaded", actorId: null, actorLabel: "applicant", targetId: link.id, detail: { type: typeId, document: summary.id, started: checks.started, skipped: checks.skipped.map((s) => s.code) }, headers });
    return { document: { id: summary.id, typeId, filename: summary.filename, sizeBytes: summary.sizeBytes }, checks: { started: checks.started, skipped: checks.skipped } };
  });
}

/** The applicant sends the file: no more upload after it. The link is used (once), and the manager sees the file as complete. */
export async function submitApplicantFile(token: string, now: Date, headers?: Headers): Promise<void> {
  const link = await fileByToken(token);
  assertOpen(linkState(link, now));
  const [count] = await query<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE screening_id = $1", [link.id]);
  if (!count?.n) throw refuse(409, "NO_DOCUMENT", "Send at least one document before submitting");
  const updated = await query<{ id: string }>("UPDATE screenings SET submitted_at = $2 WHERE id = $1 AND submitted_at IS NULL AND revoked_at IS NULL AND closed_at IS NULL RETURNING id", [link.id, now]);
  if (!updated.length) throw refuse(409, "LINK_USED", "This file was already sent");
  await audit({ action: "applicant_file.submitted", actorId: null, actorLabel: "applicant", targetId: link.id, detail: { documents: count.n }, headers });
}

/** The manager revokes a link: no upload or submission after it. A closed file cannot be revoked (it is already decided). */
export async function revokeApplicantFile(landlordId: string, id: string, now: Date, headers?: Headers): Promise<void> {
  const row = await ownedFile(landlordId, id);
  if (row.closed_at) throw refuse(409, "FILE_CLOSED", "This file was closed");
  await query("UPDATE screenings SET revoked_at = $3 WHERE id = $1 AND landlord_id = $2 AND revoked_at IS NULL", [id, landlordId, now]);
  await audit({ action: "applicant_file.revoked", actorId: landlordId, actorLabel: "manager", targetId: id, headers });
}

/**
 * Purges the files of an application: each kept file leaves its store (an external one by its object key) and the database
 * (its bytes and text); its reports stay. Returns how many files were purged. Refuses while a kept file's store is not there.
 */
export async function purgeApplicationFiles(ownerId: string, screeningId: string, store: DocumentStore | undefined): Promise<number> {
  const docs = await query<{ id: string; mime_type: string; storage: string }>(
    "SELECT id, mime_type, storage FROM documents WHERE owner_id = $1 AND screening_id = $2 AND (storage <> 'none' OR octet_length(content) > 0 OR text <> '')",
    [ownerId, screeningId],
  );
  for (const d of docs) {
    if (!EXTERNAL.has(d.storage as StorageKind)) continue;
    if (store?.describe().kind !== d.storage) throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds these documents is not available");
    await store.delete(objectKey(ownerId, d.id, d.mime_type));
  }
  const purged = await query<{ id: string }>(
    "UPDATE documents SET content = ''::bytea, text = '', storage = 'none', retain_until = NULL WHERE owner_id = $1 AND screening_id = $2 AND (storage <> 'none' OR octet_length(content) > 0 OR text <> '') RETURNING id",
    [ownerId, screeningId],
  );
  for (const p of purged) await audit({ action: "document.purged", actorId: ownerId, actorLabel: "decision", targetId: p.id, detail: { reason: "after-decision", application: screeningId } });
  return purged.length;
}

/** The manager's decision: the file is closed (the link with it) and every document is purged; its reports stay. Idempotent. */
export async function closeApplicantFile(landlordId: string, id: string, store: DocumentStore | undefined, now: Date, headers?: Headers): Promise<{ purged: number }> {
  const row = await ownedFile(landlordId, id);
  if (row.closed_at) return { purged: 0 };
  await query("UPDATE screenings SET closed_at = $3, revoked_at = coalesce(revoked_at, $3) WHERE id = $1 AND landlord_id = $2 AND closed_at IS NULL", [id, landlordId, now]);
  const purged = await purgeApplicationFiles(landlordId, id, store);
  await audit({ action: "applicant_file.closed", actorId: landlordId, actorLabel: "manager", targetId: id, detail: { purged }, headers });
  return { purged };
}

export interface FileDocumentView {
  id: string;
  typeId: string | null;
  filename: string;
  sizeBytes: number;
  pages: number | null;
  /** Kept until the decision (the applicant consented), or purged after its checks. */
  retention: string;
  purged: boolean;
  skipped: SkippedCheck[];
  /** One analysis per studio: the signals or findings Orazaka returned, its run id, and its state. */
  checks: Analysis[];
}

export interface ApplicantFileView {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: LinkState;
  createdAt: string;
  expiresAt: string;
  requestedTypes: string[];
  submittedAt: string | null;
  revokedAt: string | null;
  closedAt: string | null;
  consents: ConsentPurpose[];
  documents: FileDocumentView[];
}

/**
 * The manager's file: its documents with their checks in one place. A check still running is brought up to date first, so a
 * finished one purges its file now. The manager sees only the files of their own account.
 */
export async function applicantFileOf(landlordId: string, id: string, now: Date): Promise<ApplicantFileView> {
  const row = await ownedFile(landlordId, id);
  const ids = await query<{ id: string }>("SELECT id FROM documents WHERE owner_id = $1 AND screening_id = $2 ORDER BY created_at", [landlordId, id]);
  const checksOf = new Map<string, Analysis[]>();
  for (const { id: documentId } of ids) {
    const latest = await query<AnalysisRow>("SELECT DISTINCT ON (studio) * FROM analyses WHERE document_id = $1 ORDER BY studio, created_at DESC", [documentId]);
    checksOf.set(documentId, await Promise.all(latest.map((a) => refresh(a))));
  }
  const docs = await query<{ id: string; document_type: string | null; title: string; filename: string; size_bytes: number; pages: number | null; retention_policy: string | null; storage: string; checks_skipped: SkippedCheck[]; purged: boolean }>(
    `SELECT d.id, d.document_type, d.title, d.filename, d.size_bytes, d.pages, d.retention_policy, d.storage, d.checks_skipped,
            (d.storage = 'none' AND octet_length(d.content) = 0 AND d.text = '') AS purged
       FROM documents d WHERE d.owner_id = $1 AND d.screening_id = $2 ORDER BY d.created_at`,
    [landlordId, id],
  );
  return {
    id: row.id,
    candidateName: row.tenant_name,
    candidateEmail: row.tenant_email,
    status: linkState(row, now),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    requestedTypes: row.requested_types,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null,
    consents: await activeConsents(id),
    documents: docs.map((d) => ({
      id: d.id,
      typeId: d.document_type,
      filename: d.filename,
      sizeBytes: d.size_bytes,
      pages: d.pages,
      retention: d.retention_policy ?? "after-check",
      purged: d.purged,
      skipped: d.checks_skipped ?? [],
      checks: checksOf.get(d.id) ?? [],
    })),
  };
}

export interface FileSummary {
  id: string;
  candidateName: string;
  status: LinkState;
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  documents: number;
  /** How many documents were asked for. */
  requested: number;
  /** The manager's decision: a state of the decision set (`lib/workspace/defaults`). The link's state above is the system's fact, never merged with it. */
  decision: string;
  /** The ids of the tags the file wears (the workspace's tags of kind « applicant_file »). */
  tagIds: string[];
}

/** How the list is organised: the filters of the address (`parseView`) and the kind's decision set (read from the database), whose initial state an undecided file has. */
export interface Organised {
  filters?: ViewFilters;
  set?: StatusSet | null;
}

/** The manager's files, newest first: each one's link state, its decision, its tags and how many documents it holds; narrowed by the workspace's filter. */
export async function listApplicantFiles(landlordId: string, now: Date, organised: Organised = {}): Promise<FileSummary[]> {
  const initial = organised.set?.initial ?? DECISION.toDecide;
  const filter = filterSql(WORKSPACE, KIND.applicantFile, organised.filters ?? {}, { from: 3, status: organised.set ?? null });
  const rows = await query<FileRow & { documents: number; decision: string; tag_ids: string[] }>(
    `SELECT e.id, e.landlord_id, e.tenant_name, e.tenant_email, e.status, e.created_at, e.expires_at, e.requested_types, e.revoked_at, e.submitted_at, e.closed_at,
            (SELECT count(*)::int FROM documents d WHERE d.screening_id = e.id) AS documents,
            COALESCE((SELECT st.state FROM organize.applicant_file_status st WHERE st.entity_id = e.id), $2) AS decision,
            ARRAY(SELECT t.tag_id FROM organize.applicant_file_tag t WHERE t.entity_id = e.id) AS tag_ids
       FROM screenings e WHERE e.landlord_id = $1 AND e.flow = 'file'${filter.sql} ORDER BY e.created_at DESC LIMIT 100`,
    [landlordId, initial, ...filter.params],
  );
  return rows.map((r) => ({ id: r.id, candidateName: r.tenant_name, status: linkState(r, now), createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString(), submittedAt: r.submitted_at?.toISOString() ?? null, closedAt: r.closed_at?.toISOString() ?? null, documents: r.documents, requested: r.requested_types.length, decision: r.decision, tagIds: r.tag_ids }));
}

/**
 * How many files a view holds: the same `filterSql` as the list, so the binder's counts are the lengths of the views (yomizaka#334).
 * The list is capped at 100 rows; the count is not, and the tabs say the true number.
 */
export async function countApplicantFiles(landlordId: string, organised: Organised = {}): Promise<number> {
  const filter = filterSql(WORKSPACE, KIND.applicantFile, organised.filters ?? {}, { from: 2, status: organised.set ?? null });
  const [row] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM screenings e WHERE e.landlord_id = $1 AND e.flow = 'file'${filter.sql}`, [landlordId, ...filter.params]);
  return row?.n ?? 0;
}
