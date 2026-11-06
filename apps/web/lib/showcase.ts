import { type AcceptedType, type Analysis, type ComplianceReport, complianceReport } from "@verikora/core";

import { audit } from "./audit";
import { query } from "./db";
import { type AnalysisRow, isUuid, toAnalysis } from "./documents";
import { refuse } from "./http";
import type { buildPayload } from "./report";

/**
 * The public showcase: ONE finished compliance check an administrator has promoted, on a document an administrator has
 * declared a sample (non-personal). It is what the public page shows as « a real run » — read from this platform at
 * request time, never a copy kept in the repository. Two flags, both set from the administration and audit-logged:
 * `documents.sample` (the document may be shown) and `analyses.showcase` (this check is the one shown). Every read below
 * requires BOTH, so an unflagged or personal document is never exposed, whatever id is asked for.
 */
export interface Showcase {
  analysisId: string;
  runId: string;
  studioVersion: string | null;
  finishedAt: string;
  document: {
    title: string;
    filename: string;
    sha256: string;
    pages: number | null;
    text: string;
    mimeType: AcceptedType;
  };
  report: ComplianceReport;
}

interface ShowcaseRow extends AnalysisRow {
  d_title: string;
  d_filename: string;
  d_sha256: string;
  d_size_bytes: number;
  d_pages: number | null;
  d_text: string;
  d_mime_type: AcceptedType;
}

/** Only the sample documents' promoted, finished compliance checks — the guard every public read goes through. */
export const SHOWCASE_SQL = `SELECT a.*, d.title AS d_title, d.filename AS d_filename, d.sha256 AS d_sha256, d.size_bytes AS d_size_bytes, d.pages AS d_pages, d.text AS d_text, d.mime_type AS d_mime_type
  FROM analyses a JOIN documents d ON d.id = a.document_id
 WHERE a.showcase AND d.sample AND a.studio = 'compliance-check' AND a.status = 'succeeded' AND a.run_id IS NOT NULL
 ORDER BY a.finished_at DESC NULLS LAST LIMIT 1`;

export function showcaseOf(
  row: ShowcaseRow,
): { showcase: Showcase; analysis: Analysis; document: Parameters<typeof buildPayload>[0] } | null {
  const parsed = complianceReport.safeParse(toAnalysis(row).report);
  if (!parsed.success || !row.run_id || !row.finished_at) return null;
  return {
    showcase: {
      analysisId: row.id,
      runId: row.run_id,
      studioVersion: row.blueprint_version,
      finishedAt: row.finished_at.toISOString(),
      document: {
        title: row.d_title,
        filename: row.d_filename,
        sha256: row.d_sha256,
        pages: row.d_pages,
        text: row.d_text,
        mimeType: row.d_mime_type,
      },
      report: parsed.data,
    },
    analysis: toAnalysis(row),
    document: {
      sha256: row.d_sha256,
      filename: row.d_filename,
      title: row.d_title,
      sizeBytes: row.d_size_bytes,
      pages: row.d_pages,
    },
  };
}

async function load() {
  const [row] = await query<ShowcaseRow>(SHOWCASE_SQL);
  return row ? showcaseOf(row) : null;
}

/** The promoted check, or null — nothing promoted, or no database: the page then says so. */
export async function getShowcase(): Promise<Showcase | null> {
  return (await load())?.showcase ?? null;
}

/** The sample document's file, for the viewer — only when it is the showcase's. */
export async function showcaseFile(): Promise<{ filename: string; mimeType: string; content: Buffer } | null> {
  const [row] = await query<{ filename: string; mime_type: string; content: Buffer }>(
    `SELECT d.filename, d.mime_type, d.content FROM documents d WHERE d.sample AND d.id = (SELECT document_id FROM (${SHOWCASE_SQL}) s)`,
  );
  return row ? { filename: row.filename, mimeType: row.mime_type, content: row.content } : null;
}

type Actor = { id: string; email: string };

/** Declares a document a sample (or not). Taking the flag away also withdraws its checks from the showcase. */
export async function setSample(
  actor: Actor,
  documentId: string,
  sample: boolean,
  headers?: Headers,
): Promise<{ id: string; sample: boolean }> {
  if (!isUuid(documentId)) throw refuse(404, "NOT_FOUND", "No such document");
  const rows = await query("UPDATE documents SET sample = $2 WHERE id = $1 RETURNING id", [documentId, sample]);
  if (rows.length === 0) throw refuse(404, "NOT_FOUND", "No such document");
  if (!sample) await query("UPDATE analyses SET showcase = false WHERE document_id = $1 AND showcase", [documentId]);
  await audit({
    action: sample ? "admin.document_sample_set" : "admin.document_sample_unset",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: documentId,
    headers,
  });
  return { id: documentId, sample };
}

/** Promotes a finished compliance check of a sample document to the public showcase (replacing the previous one), or withdraws it. */
export async function setShowcase(
  actor: Actor,
  analysisId: string,
  on: boolean,
  headers?: Headers,
): Promise<{ id: string; showcase: boolean }> {
  if (!isUuid(analysisId)) throw refuse(404, "NOT_FOUND", "No such analysis");
  if (!on) {
    const rows = await query("UPDATE analyses SET showcase = false WHERE id = $1 RETURNING id", [analysisId]);
    if (rows.length === 0) throw refuse(404, "NOT_FOUND", "No such analysis");
  } else {
    const [row] = await query<{ id: string; sample: boolean; studio: string; status: string }>(
      "SELECT a.id, d.sample, a.studio, a.status FROM analyses a JOIN documents d ON d.id = a.document_id WHERE a.id = $1",
      [analysisId],
    );
    if (!row) throw refuse(404, "NOT_FOUND", "No such analysis");
    if (!row.sample)
      throw refuse(409, "NOT_A_SAMPLE", "Only a check on a document marked as a sample can be shown publicly");
    if (row.studio !== "compliance-check" || row.status !== "succeeded")
      throw refuse(409, "NOT_SHOWABLE", "Only a finished compliance check can be shown publicly");
    await query(
      "WITH off AS (UPDATE analyses SET showcase = false WHERE showcase AND id <> $1) UPDATE analyses SET showcase = true WHERE id = $1",
      [analysisId],
    );
  }
  await audit({
    action: on ? "admin.showcase_set" : "admin.showcase_unset",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: analysisId,
    headers,
  });
  return { id: analysisId, showcase: on };
}

/** The showcase as the public page shows it: the run, the sample and the findings — never a signed file (ADR-0002, specimens). */
export async function getShowcaseView(): Promise<Showcase | null> {
  return (await load())?.showcase ?? null;
}
