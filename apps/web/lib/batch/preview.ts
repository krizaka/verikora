import { BATCH_ROW_ERROR, type BatchRow, matchBatchFiles, readBatchManifest } from "@verikora/core";

import { entitlementOf } from "../billing";
import { query } from "../db";
import { inspectUpload } from "../documents";
import { HttpError, refuse } from "../http";
import { VERIKORA_RULES } from "../preflight/rules";
import { findReusableAnalysis } from "../preflight-events";
import { preflightRulesFrom, type Snapshot } from "../settings/boundary";

/**
 * What a batch would do, before anything is stored or run (verikora#232, part 1): each row checked against the single-check
 * rules and the pre-flight, a file already known found by its SHA-256, a result that can be reused (no audit spent), and
 * the audits the rest needs against what the account has. Nothing is written: the preview is read-only.
 */
export const PREVIEW_ROW = { check: "check", reuse: "reuse", refused: "refused" } as const;
export type PreviewRowState = (typeof PREVIEW_ROW)[keyof typeof PREVIEW_ROW];

export interface PreviewRow {
  line: number;
  file: string;
  studio: string | null;
  state: PreviewRowState;
  /** The row's problems: the manifest's (`UNKNOWN_CHECK`…) and the pre-flight's own codes (`FILE_ACTIVE_CONTENT`…), as a single upload says them. */
  errors: string[];
  reference: string | null;
}

export interface BatchPreview {
  rows: PreviewRow[];
  missingColumns: string[];
  unknownColumns: string[];
  unnamedFiles: string[];
  counts: { check: number; reuse: number; refused: number };
  /** The audits the « check » rows spend, and whether the account covers them now (Pro, credits, the free first audit). */
  cost: { audits: number; covered: boolean; credits: number; pro: boolean };
}

export interface BatchFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

const preflightCode = (error: unknown) =>
  error instanceof HttpError ? String((error.body as { code?: string })?.code ?? "REFUSED") : "REFUSED";

export async function previewBatch(
  ownerId: string,
  manifestText: string,
  files: readonly BatchFile[],
  settings: Snapshot,
  now: Date,
): Promise<BatchPreview> {
  const manifest = readBatchManifest(manifestText);
  const maxRows = settings["limits.batchMaxRows"].value as number;
  if (manifest.rows.length > maxRows)
    throw refuse(413, "BATCH_TOO_LARGE", `A batch has at most ${maxRows} rows`, { limit: maxRows });
  const { rows, unnamedFiles } = matchBatchFiles(
    manifest,
    files.map((f) => f.name),
  );
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));

  const preview: PreviewRow[] = [];
  for (const row of rows)
    preview.push(await previewRow(ownerId, row, byName.get(row.file.toLowerCase()), settings, now));

  const counts = { check: 0, reuse: 0, refused: 0 };
  for (const r of preview) counts[r.state]++;
  const entitlement = await entitlementOf(query, ownerId, now);
  const freeFirst = (settings["audit.freeFirst"].value as boolean) && !entitlement.freeAuditUsed ? 1 : 0;
  const covered = entitlement.pro || entitlement.credits + freeFirst >= counts.check;
  return {
    rows: preview,
    missingColumns: manifest.missingColumns,
    unknownColumns: manifest.unknownColumns,
    unnamedFiles,
    counts,
    cost: { audits: counts.check, covered, credits: entitlement.credits, pro: entitlement.pro },
  };
}

async function previewRow(
  ownerId: string,
  row: BatchRow,
  file: BatchFile | undefined,
  settings: Snapshot,
  now: Date,
): Promise<PreviewRow> {
  const base = { line: row.line, file: row.file, studio: row.request?.studio ?? null, reference: row.reference };
  if (row.errors.length || !row.request || !file)
    return {
      ...base,
      state: PREVIEW_ROW.refused,
      errors: row.errors.length ? row.errors : [BATCH_ROW_ERROR.fileNotSent],
    };
  let sha256: string;
  try {
    // The workspace's own pre-flight rules (size, allowed types), as a single upload applies them.
    ({ sha256 } = await inspectUpload(
      { name: file.name, type: file.type, size: file.bytes.length },
      file.bytes,
      preflightRulesFrom(VERIKORA_RULES, settings),
    ));
  } catch (error) {
    return { ...base, state: PREVIEW_ROW.refused, errors: [preflightCode(error)] };
  }
  const [known] = await query<{ id: string }>("SELECT id FROM documents WHERE owner_id = $1 AND sha256 = $2", [
    ownerId,
    sha256,
  ]);
  if (known) {
    const r = row.request;
    const reusable = await findReusableAnalysis(query, {
      reuseDays: settings["limits.reuseDays"].value as number,
      now,
      ownerId,
      documentId: known.id,
      studio: r.studio,
      jurisdiction: r.studio === "compliance-check" ? r.jurisdiction : null,
      ruleset: r.studio === "compliance-check" ? (r.ruleset ?? null) : null,
      expectedIssuer: r.studio === "document-authenticity" ? (r.expectedIssuer ?? null) : null,
    });
    if (reusable) return { ...base, state: PREVIEW_ROW.reuse, errors: [] };
  }
  return { ...base, state: PREVIEW_ROW.check, errors: [] };
}
