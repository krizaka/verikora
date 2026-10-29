import { localDay } from "@krizaka/intl";
import { type Analysis, AUTHENTICITY_MAX_BYTES, COMPLIANCE_MAX_CHARS, DOCX_MIME, type ExtractionStatus, fromRunStatus, isExtracting, isTerminal, ODT_MIME, type OrazakaRun, reportOf, type StartAnalysis,type StorageKind } from "@yomizaka/core";

import { holderOf as documentHolder } from "@/app/active-store";

import { assertAnalysisAllowed } from "./applicant-consent";
import { refundFailedAudit } from "./billing";
import { query } from "./db";
import { type AnalysisRow, declaredKindOf, isUuid, needsAttention, readBytes, toAnalysis } from "./documents";
import { refuse } from "./http";
import { withLines } from "./lease-lines";
import { orazaka } from "./orazaka";
import { purgeIfDone } from "./retention";
import { withSectionG } from "./rules/section-g-report";
import { LAW_TIME_ZONE } from "./rulesets";
import { appSettings } from "./settings/instance";
import type { DocumentStore } from "./storage/port";

/**
 * An analysis is an Orazaka run. Starting one sends the document to the Studio that does the job — the compliance
 * check reads the text against a jurisdiction's rules, the authenticity check reads the PDF file itself — and keeps the
 * run id. Reading one asks Orazaka for the run until it is finished, then keeps the report Orazaka returned (and the
 * words a search should find in it). Yomizaka adds no verdict of its own.
 */
/** What the authenticity Studio examines as a file (document-authenticity 1.3.0 reads PDF, images and office files; a photo document is read at upload instead, ADR-0010). */
const AUTHENTICITY_TYPES: ReadonlySet<string> = new Set(["application/pdf", DOCX_MIME, ODT_MIME]);

export function runInputs(request: StartAnalysis, doc: { mimeType: string; text: string; content: Buffer }, today = new Date()): Record<string, string> {
  if (request.studio === "compliance-check") {
    if (!doc.text.trim()) throw refuse(422, "NO_TEXT", "This document has no text layer to check");
    if (doc.text.length > COMPLIANCE_MAX_CHARS) throw refuse(422, "TEXT_TOO_LONG", "This document is longer than the compliance check reads");
    return { document: doc.text, jurisdiction: request.jurisdiction, asOf: request.asOf ?? localDay(today, LAW_TIME_ZONE),...(request.ruleset ? { ruleset: request.ruleset } : {}) };
  }
  if (!AUTHENTICITY_TYPES.has(doc.mimeType)) throw refuse(422, "NOT_A_PDF", "The authenticity check reads PDF and Word files");
  if (doc.content.length > AUTHENTICITY_MAX_BYTES) throw refuse(422, "PDF_TOO_LARGE", "The authenticity check reads files up to 5 MB");
  return { documentBase64: doc.content.toString("base64"), ...(request.expectedIssuer ? { expectedIssuer: request.expectedIssuer } : {}) };
}

/** The words a search should find in a report: rule titles, explanations, quoted passages, citations, signals. */
export function searchText(report: ReturnType<typeof reportOf>): string {
  if (!report) return "";
  if ("findings" in report) return report.findings.flatMap((f) => [f.ruleId, f.title ?? "", f.explanation, f.evidenceSpan?.quote ?? "", f.citation ?? ""]).join("\n");
  return report.signals.flatMap((s) => [s.signalId, s.observation, s.mayIndicate ?? "", s.where ?? ""]).join("\n");
}

export async function startAnalysis(ownerId: string, documentId: string, request: StartAnalysis, flowVersionId: string | null = null, billedVia: string | null = null, store?: DocumentStore): Promise<Analysis> {
  if (!isUuid(documentId)) throw refuse(404, "NOT_FOUND", "No such document");
  const [doc] = await query<{ mime_type: string; text: string; content: Buffer; storage: StorageKind; object_key: string | null; screening_id: string | null; extraction: ExtractionStatus; extraction_error: string | null }>("SELECT mime_type, text, content, storage, object_key, screening_id, extraction, extraction_error FROM documents WHERE owner_id = $1 AND id = $2", [ownerId, documentId]);
  if (!doc) throw refuse(404, "NOT_FOUND", "No such document");
  // The text is read after the upload answered (yomizaka#21): a check waits for it, or says why it will never come.
  if (isExtracting(doc.extraction)) throw refuse(409, "EXTRACTING", "The document is still being read");
  if (doc.extraction === "failed") throw refuse(422, doc.extraction_error ?? "UNREADABLE_FILE", "The document could not be read");
  // A document of an application is checked only while the applicant's consent to the document check stands (yomizaka#131).
  await assertAnalysisAllowed(doc.screening_id);
  // The file comes from where the document lives (a purged one has none: 409 NOT_KEPT); the compliance check reads the text, which a purge also removes.
  const content = request.studio === "compliance-check" ? doc.content : await readBytes(doc, { ownerId, id: documentId }, store);
  if (request.studio === "compliance-check" && doc.storage === "none" && doc.text === "" && doc.content.length === 0 && !doc.object_key) throw refuse(409, "NOT_KEPT", "This document is not kept: only its report stays");
  const [running] = await query("SELECT id FROM analyses WHERE document_id = $1 AND studio = $2 AND status = 'running'", [documentId, request.studio]);
  if (running) throw refuse(409, "ALREADY_RUNNING", "This check is already running");
  // The text is validated first (NO_TEXT, TEXT_TOO_LONG); only then the kind: a kind with no ruleset in force is said so, and the
  // lease's rules are never the fallback for it (ADR-089).
  const inputs = runInputs(request, { mimeType: doc.mime_type, text: doc.text, content });
  if (request.studio === "compliance-check" && !request.ruleset && (await declaredKindOf(ownerId, documentId)) === "other") throw refuse(422, "KIND_NOT_VERIFIED", "This kind of document is not checked against the law yet");
  const run = await orazaka().startRun(request.studio, inputs);
  const kept = Object.fromEntries(Object.entries(inputs).filter(([k]) => k !== "document" && k !== "documentBase64"));
  const [row] = await query<AnalysisRow>(
    "INSERT INTO analyses (document_id, studio, status, run_id, blueprint_version, inputs, flow_version_id, billed_via) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
    [documentId, request.studio, fromRunStatus(run.status), run.id, run.blueprintVersion ?? null, JSON.stringify(kept), flowVersionId, billedVia],
  );
  return isTerminal(row!.status) ? refresh(row!, run) : toAnalysis(row!);
}

/** Brings an analysis up to date with its Orazaka run (only while it runs; a finished one is kept as it was). */
export async function refresh(row: AnalysisRow, known?: OrazakaRun): Promise<Analysis> {
  if (row.status !== "running" && !known) return toAnalysis(row);
  if (!row.run_id) return toAnalysis(row);
  const run = known ?? (await orazaka().getRun(row.run_id));
  const status = fromRunStatus(run.status);
  if (!isTerminal(status)) return toAnalysis(row);
  const read = status === "succeeded" ? reportOf(row.studio, run.outputs) : null;
  // The line of each finding is read now: the text is purged once the check has run (yomizaka#129).
  const lined = read && "findings" in read ? withLines(read, (await query<{ text: string }>("SELECT text FROM documents WHERE id = $1", [row.document_id]))[0]?.text ?? "") : read;
  // Section G (yomizaka#554): when the lease ruleset exposed the rents, the check compares them with the TAL's rate.
  const report = lined && "findings" in lined ? await withSectionG(lined, appSettings()) : lined;
  const noReport = report ? null : "Orazaka finished without a report Yomizaka can read";
  const error = status === "succeeded" ? noReport : (run.errorMessage ?? `The run ended ${run.status}`);
  const [updated] = await query<AnalysisRow>(
    `UPDATE analyses SET status = $2, report = $3, error = $4, search_text = $5, blueprint_version = coalesce($6, blueprint_version), finished_at = coalesce($7::timestamptz, now())
      WHERE id = $1 RETURNING *`,
    [row.id, report ? status : "failed", report ? JSON.stringify({ ...report, attention: needsAttention(report) }) : null, error, searchText(report), run.blueprintVersion ?? null, run.finishedAt ?? null],
  );
  // A run that failed gives its audit back (once): the person is not charged for a check that produced nothing.
  if (!report) await refundFailedAudit(query, row.id);
  // Not kept: once the check has run, the file and the text are purged; only the report stays.
  await purgeIfDone(query, row.document_id, documentHolder);
  return toAnalysis(updated!);
}

export async function getAnalysis(ownerId: string, documentId: string, analysisId: string): Promise<Analysis> {
  if (!isUuid(documentId) || !isUuid(analysisId)) throw refuse(404, "NOT_FOUND", "No such analysis");
  const [row] = await query<AnalysisRow>(
    "SELECT a.* FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 AND a.document_id = $2 AND a.id = $3",
    [ownerId, documentId, analysisId],
  );
  if (!row) throw refuse(404, "NOT_FOUND", "No such analysis");
  return refresh(row);
}
