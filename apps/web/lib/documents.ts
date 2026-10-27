import { type AcceptedType, type Analysis, type AnalysisStatus, type AuthenticityReport, type CloudOwner, type ComplianceReport, type DocumentDetail, type DocumentInsight, type DocumentKind, type DocumentStatus, type DocumentSummary, DOCX_MIME, type ExtractionStatus, ODT_MIME, type StorageKind, type Studio, type TextSource } from "@yomizaka/core";

import { query } from "./db";
import { ExtractionError } from "./extraction/isolated";
import { isGenericName } from "./generic-name";
import { HttpError, refuse } from "./http";
import { readText } from "./pdf-text";
import { personalInfo } from "./pii";
import { createInspector } from "./preflight/inspector";
import { type FileKind, OUTCOME, type PreflightRules, type RejectReason } from "./preflight/port";
import { YOMIZAKA_RULES } from "./preflight/rules";
import { EXTERNAL, objectKey, purgeDeadline, storageFor } from "./retention";
import type { DocumentStore, StoreDescriptor } from "./storage/port";
import { storedAs } from "./storage/where";
import { understanding } from "./understanding";

interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  mime_type: AcceptedType;
  kind: DocumentKind;
  size_bytes: number;
  pages: number | null;
  has_text: boolean;
  created_at: Date;
  extraction: ExtractionStatus;
  statuses: { studio: Studio; status: AnalysisStatus; attention: boolean }[] | null;
}

export interface AnalysisRow {
  id: string;
  document_id: string;
  studio: Studio;
  status: AnalysisStatus;
  run_id: string | null;
  blueprint_version: string | null;
  inputs: Record<string, string>;
  report: ComplianceReport | AuthenticityReport | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

/** Whether a report asks for attention: a failed blocking rule, or a signal Orazaka calls incoherent. */
export function needsAttention(report: ComplianceReport | AuthenticityReport | null): boolean {
  if (!report) return false;
  if ("findings" in report) return report.findings.some((f) => f.verdict === "FAIL" && f.severity === "BLOCKING");
  return report.signals.some((s) => s.level === "incohérent");
}

/** A document's state from its latest analysis per Studio. */
export function documentStatus(latest: { status: AnalysisStatus; attention: boolean }[]): DocumentStatus {
  if (latest.length === 0) return "stored";
  if (latest.some((a) => a.status === "running")) return "analysing";
  if (latest.some((a) => a.status === "succeeded" && a.attention)) return "attention";
  if (latest.every((a) => a.status !== "succeeded")) return "failed";
  return "checked";
}

// A reading that was queued or running and never ended (the process restarted) is shown as failed after a few minutes, never as an endless wait.
const SUMMARY_COLUMNS = `d.id, d.title, d.filename, d.mime_type, d.kind, d.size_bytes, d.pages, d.text <> '' AS has_text, d.created_at,
  CASE WHEN d.extraction IN ('queued', 'running') AND d.extraction_at < now() - interval '3 minutes' THEN 'failed' ELSE d.extraction END AS extraction,
  (SELECT json_agg(json_build_object('studio', l.studio, 'status', l.status, 'attention', l.attention))
     FROM (SELECT DISTINCT ON (a.studio) a.studio, a.status, coalesce((a.report->>'attention')::boolean, false) AS attention
             FROM analyses a WHERE a.document_id = d.id ORDER BY a.studio, a.created_at DESC) l) AS statuses`;

function summary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mime_type,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    pages: row.pages,
    hasText: row.has_text,
    status: documentStatus(row.statuses ?? []),
    extraction: row.extraction,
    createdAt: row.created_at.toISOString(),
  };
}

export function toAnalysis(row: AnalysisRow): Analysis {
  const report = { ...((row.report ?? {}) as Record<string, unknown>) };
  delete report.attention;
  return {
    id: row.id,
    studio: row.studio,
    status: row.status,
    runId: row.run_id,
    blueprintVersion: row.blueprint_version,
    inputs: Object.fromEntries(Object.entries(row.inputs ?? {}).filter(([k]) => k !== "documentBase64" && k !== "document")),
    report: row.report ? (report as unknown as Analysis["report"]) : null,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

export async function listDocuments(ownerId: string): Promise<DocumentSummary[]> {
  const rows = await query<DocumentRow>(`SELECT ${SUMMARY_COLUMNS} FROM documents d WHERE d.owner_id = $1 ORDER BY d.created_at DESC LIMIT 500`, [ownerId]);
  return rows.map(summary);
}

/** The summaries of these documents (the organisation hands out ids), in the order given. */
export async function documentsByIds(ownerId: string, ids: string[]): Promise<DocumentSummary[]> {
  if (!ids.length) return [];
  const rows = await query<DocumentRow>(`SELECT ${SUMMARY_COLUMNS} FROM documents d WHERE d.owner_id = $1 AND d.id = ANY($2::uuid[])`, [ownerId, ids]);
  const byId = new Map(rows.map((r) => [r.id, summary(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function getDocument(ownerId: string, id: string): Promise<DocumentDetail> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such document");
  const [row] = await query<DocumentRow & { sha256: string; text: string; text_source: TextSource | null; extraction_error: string | null }>(`SELECT ${SUMMARY_COLUMNS}, d.sha256, d.text, d.text_source, d.extraction_error FROM documents d WHERE d.owner_id = $1 AND d.id = $2`, [ownerId, id]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such document");
  const analyses = await query<AnalysisRow>("SELECT * FROM analyses WHERE document_id = $1 ORDER BY created_at DESC LIMIT 50", [id]);
  return { ...summary(row), extractionError: row.extraction === "failed" ? (row.extraction_error ?? "UNREADABLE_FILE") : null, sha256: row.sha256, text: row.text, textSource: row.text_source ?? undefined, insight: row.text ? insightOf(row.text, row.pages) : undefined, analyses: analyses.map(toAnalysis) };
}

/** Whether a document was made from photos (its file is a PDF Yomizaka assembled: file-level authenticity signals would describe Yomizaka, not the document). */
export async function isPhotoDocument(ownerId: string, id: string): Promise<boolean> {
  const [row] = await query<{ photo: boolean }>("SELECT text_source IS NOT NULL AS photo FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, id]);
  return row?.photo ?? false;
}

/** The kind declared on a document (« Quel document ? »): the compliance check never falls back to a lease's rules for `other`. */
export async function declaredKindOf(ownerId: string, id: string): Promise<DocumentKind | null> {
  const [row] = await query<{ kind: DocumentKind }>("SELECT kind FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, id]);
  return row?.kind ?? null;
}

/** Where a document lives and until when (the info panel, ADR-0007), from its row and the store configured now. */
export async function documentStorage(ownerId: string, id: string, describe: (owner: CloudOwner) => StoreDescriptor): Promise<{ storage: StoreDescriptor; retainUntil: string | null; purged: boolean }> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such document");
  const [row] = await query<{ storage: StorageKind; storage_owner: CloudOwner; retain_until: Date | null; purged: boolean }>("SELECT storage, storage_owner, retain_until, (storage = 'none' AND octet_length(content) = 0 AND text = '') AS purged FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, id]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such document");
  return { storage: storedAs(row.storage, describe(row.storage_owner)), retainUntil: row.retain_until?.toISOString() ?? null, purged: row.purged };
}

/** The bytes of a document, from where it lives: the database, or the external store that holds it. A purged document has none (409 NOT_KEPT). */
export async function readBytes(row: { mime_type: string; content: Buffer; storage: StorageKind }, ids: { ownerId: string; id: string }, store?: DocumentStore): Promise<Buffer> {
  if (EXTERNAL.has(row.storage)) {
    if (!store || store.describe().kind !== row.storage) throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds this document is not available");
    const found = await store.get(objectKey(ids.ownerId, ids.id, row.mime_type));
    if (!found) throw refuse(404, "NOT_FOUND", "No such document");
    return Buffer.from(found.bytes);
  }
  if (row.storage === "none" && row.content.length === 0) throw refuse(409, "NOT_KEPT", "This document is not kept: only its report stays");
  return row.content;
}

export async function getFile(ownerId: string, id: string, store?: DocumentStore): Promise<{ filename: string; mimeType: string; content: Buffer }> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such document");
  const [row] = await query<{ filename: string; mime_type: string; content: Buffer; storage: StorageKind }>("SELECT filename, mime_type, content, storage FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, id]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such document");
  return { filename: row.filename, mimeType: row.mime_type, content: await readBytes(row, { ownerId, id }, store) };
}

/** Deletes a document at once: its file on the external store first, then the row (its reports go with it). */
export async function deleteDocument(ownerId: string, id: string, store?: DocumentStore): Promise<void> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such document");
  const [row] = await query<{ mime_type: string; storage: StorageKind }>("SELECT mime_type, storage FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, id]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such document");
  if (EXTERNAL.has(row.storage)) {
    if (!store || store.describe().kind !== row.storage) throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds this document is not available");
    await store.delete(objectKey(ownerId, id, row.mime_type));
  }
  await query("DELETE FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, id]);
}

/** What the document is and holds — read in-process from its text, for nothing; personal information as counts only. */
export function insightOf(text: string, pages: number | null): DocumentInsight {
  const { total, counts } = personalInfo.scan(text);
  return { understanding: understanding.understand(text, { pages }), pii: { total, counts: counts as Record<string, number> } };
}

/** The upload form's « automatic » choice: the document kind follows the detected nature (never a default that is wrong). */
export function kindFromNature(natureId: string | null): DocumentKind {
  switch (natureId) {
    case "residential-lease":
      return "lease";
    case "invoice":
      return "invoice";
    case "service-contract":
      return "contract";
    default:
      return "other";
  }
}

/** Why a file is refused: the HTTP answer and the stable code the page translates (messages `console.errors.*`). */
const REFUSALS: Record<RejectReason, { status: number; code: string }> = {
  EMPTY: { status: 400, code: "EMPTY_FILE" },
  TOO_LARGE: { status: 413, code: "FILE_TOO_LARGE" },
  UNSUPPORTED_TYPE: { status: 415, code: "UNSUPPORTED_TYPE" },
  TYPE_MISMATCH: { status: 415, code: "FILE_TYPE_MISMATCH" },
  EXECUTABLE: { status: 415, code: "FILE_EXECUTABLE" },
  CORRUPT: { status: 422, code: "UNREADABLE_FILE" },
  TRUNCATED: { status: 422, code: "FILE_TRUNCATED" },
  ENCRYPTED: { status: 422, code: "FILE_ENCRYPTED" },
  TOO_MANY_PAGES: { status: 422, code: "FILE_TOO_MANY_PAGES" },
  ACTIVE_CONTENT: { status: 422, code: "FILE_ACTIVE_CONTENT" },
  ARCHIVE_BOMB: { status: 422, code: "FILE_ARCHIVE_BOMB" },
  IMAGE_TOO_LARGE: { status: 413, code: "IMAGE_TOO_LARGE" },
};

const defaultInspector = createInspector(YOMIZAKA_RULES);

/** The pre-flight (lib/preflight, ADR-0005): what an upload must be, decided here for nothing before anything is stored or sent to an engine. */
export async function inspectUpload(file: { name: string; type: string; size: number }, bytes: Uint8Array, rules?: PreflightRules): Promise<{ fileKind: FileKind; sha256: string; pages: number | null }> {
  const outcome = await (rules ? createInspector(rules) : defaultInspector).inspect(bytes, file);
  if (outcome.kind === OUTCOME.rejected) {
    const { status, code } = REFUSALS[outcome.reason];
    throw refuse(status, code, `Refused by the pre-flight: ${outcome.reason}`, { reason: outcome.reason });
  }
  return { fileKind: outcome.fileKind, sha256: outcome.sha256, pages: outcome.pages };
}

/** A PDF or a text file (photos go through lib/photos, which hands the pre-flight a PDF made of them). */
/** The stored type of each kind a file upload accepts. */
const MIME_OF = { pdf: "application/pdf", text: "text/plain", docx: DOCX_MIME, odt: ODT_MIME } as const satisfies Record<string, AcceptedType>;

export async function checkUpload(file: { name: string; type: string; size: number }, bytes: Uint8Array, rules?: PreflightRules): Promise<{ mimeType: AcceptedType; sha256: string; pages: number | null }> {
  const { fileKind, sha256, pages } = await inspectUpload(file, bytes, rules);
  if (fileKind !== "pdf" && fileKind !== "text" && fileKind !== "docx" && fileKind !== "odt") throw refuse(415, "UNSUPPORTED_TYPE", "Photos are sent as photos, not as a file");
  return { mimeType: MIME_OF[fileKind], sha256, pages };
}

export const titleOf = (filename: string) => filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 200) || "Document";
/** NFC first (a macOS name arrives decomposed: the accent is a combining mark), then keep letters, marks, digits and apostrophes. */
/** A filename that says nothing (scan, IMG_2041, a hash): the title then comes from the (normalised) first line of the text. */
export function titleFor(filename: string, text: string): string {
  const fromName = titleOf(filename);
  if (!isGenericName(fromName)) return fromName;
  const first = text.split("\n").map((l) => l.trim()).find((l) => l.length >= 4);
  return first ? first.slice(0, 120) : fromName;
}

export const safeFilename = (name: string) => name.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}._ '’-]+/gu, "_").slice(0, 200) || "document";

/** What a new document is subject to: kept or purged after the check (ADR-0007). Without a policy a document is kept in the database (legacy callers, tests). */
export interface StoragePolicy {
  keep: boolean;
  store: DocumentStore;
  now: Date;
  purgeAfterHours: number;
  /** The pre-flight rules as configured (limits an administrator set); the product's own when absent. */
  rules?: PreflightRules;
}

/** The text of a document that has no text layer — read only if the document is new (a duplicate is never read twice). */
export type TextReader = () => Promise<{ text: string; source: TextSource }>;

/** What the isolated PDF reader's failures say to the person: too long, too heavy to read in time, or simply not readable. */
export function extractionRefusal(error: ExtractionError): HttpError {
  switch (error.code) {
    case "TOO_MANY_PAGES":
      return refuse(422, "FILE_TOO_MANY_PAGES", "Refused: too many pages");
    case "TIMEOUT":
    case "MEMORY":
      return refuse(422, "FILE_TOO_COMPLEX", "Refused: this PDF is too heavy to read within the limits");
    default:
      return refuse(422, "UNREADABLE_FILE", "This PDF cannot be opened");
  }
}

/** The text of a new document: from the reader given (a photo), or from its text layer; an unreadable file is a 422. */
async function readNewDocument(mimeType: AcceptedType, bytes: Uint8Array, pages: number | null, textOf?: TextReader): Promise<{ read: { text: string; pages: number | null }; source: TextSource | null }> {
  try {
    if (!textOf) return { read: await readText(mimeType, bytes), source: null };
    const recognised = await textOf();
    return { read: { text: recognised.text, pages }, source: recognised.source };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof ExtractionError) throw extractionRefusal(error);
    throw refuse(422, "UNREADABLE_FILE", "This PDF cannot be opened");
  }
}

/** Writes the document's row: restores a purged duplicate in place, or inserts a new one. */
async function saveDocumentRow(args: { ownerId: string; existingId: string | null; file: { filename: string; mimeType: AcceptedType; kind: DocumentKind; sha256: string; pages: number | null }; bytes: Uint8Array; text: string; where: StorageKind; deadline: Date | null; source: TextSource | null; extraction: "queued" | "done" }): Promise<DocumentRow> {
  const { ownerId, existingId, file, bytes, text, where, deadline, source, extraction } = args;
  const [row] = existingId
    ? await query<DocumentRow>(`WITH d AS (UPDATE documents SET content = $3, text = $4, storage = $5, retain_until = $6, text_source = $7, extraction = $8, extraction_error = NULL, extraction_at = now() WHERE owner_id = $1 AND id = $2 RETURNING *) SELECT ${SUMMARY_COLUMNS} FROM d`, [ownerId, existingId, Buffer.from(bytes), text, where, deadline, source, extraction])
    : await query<DocumentRow>(
        `WITH d AS (
           INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, pages, content, text, storage, retain_until, text_source, extraction)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *)
         SELECT ${SUMMARY_COLUMNS} FROM d`,
        [ownerId, titleFor(file.filename, text), file.filename, file.mimeType, file.kind, bytes.length, file.sha256, file.pages, Buffer.from(bytes), text, where, deadline, source, extraction],
      );
  return row!;
}

/** Moves the bytes to the external store; if it does not answer, the new row goes away and the upload is refused (502). */
async function moveToStore(policy: StoragePolicy, ownerId: string, id: string, mimeType: AcceptedType, bytes: Uint8Array): Promise<void> {
  try {
    await policy.store.put(objectKey(ownerId, id, mimeType), bytes, { contentType: mimeType });
  } catch {
    await query("DELETE FROM documents WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM analyses WHERE document_id = $1)", [id]);
    throw refuse(502, "STORAGE_UNAVAILABLE", "The storage that keeps documents did not answer");
  }
  await query("UPDATE documents SET content = ''::bytea, storage_owner = $2 WHERE id = $1", [id, policy.store.describe().owner === "workspace" ? "workspace" : "krizaka"]);
}

export async function storeDocument(ownerId: string, file: { name: string; type: string; size: number }, bytes: Uint8Array, requested: DocumentKind | "auto", policy?: StoragePolicy, textOf?: TextReader, options: { defer?: boolean } = {}): Promise<{ summary: DocumentSummary; duplicate: boolean; finish?: () => Promise<void> }> {
  const { mimeType, sha256, pages } = await checkUpload(file, bytes, policy?.rules);
  const where = policy ? storageFor(policy.keep, policy.store.describe()) : "database";
  const [existing] = await query<DocumentRow & { purged: boolean }>(`SELECT ${SUMMARY_COLUMNS}, (d.storage = 'none' AND octet_length(d.content) = 0 AND d.text = '') AS purged FROM documents d WHERE d.owner_id = $1 AND d.sha256 = $2`, [ownerId, sha256]);
  // The same file again: reused as it is — unless it was purged and the person now keeps it, then it is restored below; or its reading failed, then it is read again.
  if (existing && existing.extraction !== "failed" && !(existing.purged && where !== "none")) return { summary: summary(existing), duplicate: true };
  const filename = safeFilename(file.name);
  const deadline = where === "none" && policy ? purgeDeadline(policy.now, policy.purgeAfterHours) : null;
  // Deferred (the upload route): the row is saved at once with its text still to read — an isolated worker reads it after the answer (yomizaka#21).
  const deferred = options.defer === true && !textOf;
  const { read, source } = deferred ? { read: { text: "", pages }, source: null } : await readNewDocument(mimeType, bytes, pages, textOf);
  const kind = requested !== "auto" ? requested : deferred ? "other" : kindFromNature(understanding.understand(read.text, { pages: read.pages }).nature?.id ?? null);
  // The bytes sit in the database until the document is placed (and, if not kept, until its check has run).
  const row = await saveDocumentRow({ ownerId, existingId: existing?.id ?? null, file: { filename, mimeType, kind, sha256, pages: read.pages }, bytes, text: read.text, where, deadline, source, extraction: deferred ? "queued" : "done" });
  // Kept by the owner's choice: the day is recorded (a keep is a consent, with a date).
  if (policy && where !== "none") await query("UPDATE documents SET keep_consent_at = COALESCE(keep_consent_at, $2) WHERE id = $1", [row.id, policy.now]);
  if (policy && EXTERNAL.has(where)) await moveToStore(policy, ownerId, row.id, mimeType, bytes);
  return { summary: summary(row), duplicate: false, ...(deferred ? { finish: () => finishExtraction({ ownerId, id: row.id, filename, mimeType, requested, bytes }) } : {}) };
}

/**
 * Reads the text of a deferred document in the isolated worker and completes its row: the text, the pages, the kind it turns out
 * to be (when the person left it to Yomizaka) and the title. A failure is kept on the row, with the code the page translates.
 */
export async function finishExtraction(args: { ownerId: string; id: string; filename: string; mimeType: AcceptedType; requested: DocumentKind | "auto"; bytes: Uint8Array }): Promise<void> {
  const { ownerId, id, filename, mimeType, requested, bytes } = args;
  await query("UPDATE documents SET extraction = 'running', extraction_at = now() WHERE owner_id = $1 AND id = $2 AND extraction = 'queued'", [ownerId, id]);
  try {
    const read = await readText(mimeType, bytes);
    const kind = requested === "auto" ? kindFromNature(understanding.understand(read.text, { pages: read.pages }).nature?.id ?? null) : requested;
    await query("UPDATE documents SET text = $3, pages = $4, kind = $5, title = $6, extraction = 'done', extraction_error = NULL, extraction_at = now() WHERE owner_id = $1 AND id = $2 AND extraction IN ('queued', 'running')", [ownerId, id, read.text, read.pages, kind, titleFor(filename, read.text)]);
  } catch (error) {
    const code = error instanceof ExtractionError ? String(extractionRefusal(error).body.code) : "UNREADABLE_FILE";
    await query("UPDATE documents SET extraction = 'failed', extraction_error = $3, extraction_at = now() WHERE owner_id = $1 AND id = $2 AND extraction IN ('queued', 'running')", [ownerId, id, code]);
  }
}

export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
