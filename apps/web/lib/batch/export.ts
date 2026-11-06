import type { Analysis } from "@verikora/core";

import { refuse } from "../http";
import { trimEdges } from "../trim-edges";
import { buildZip, type ZipEntry } from "../zip";
import { csvCell } from "./csv-out";
import { BATCH_ITEM, type BatchItemView, type BatchView } from "./run";

/**
 * The reports of a batch in one ZIP (verikora#242): `lot.csv` (each row's state, reason and report file), `rapports/` (the signed PDF of
 * every compliance row that has a report, in the language asked) and `signaux/` (the signals of every authenticity row, as Sovkora
 * returned them), and a LISEZ-MOI. A row whose report cannot be issued is listed with its reason, never silently missing. The reports
 * are the ones the page offers one by one — same bytes, same signature — and the same rules as the batch's other exports.
 */
export interface ExportDeps {
  /** The signed PDF of a finished compliance check in a language, or a refusal with its stable code. */
  pdf(item: BatchItemView): Promise<{ bytes: Uint8Array } | { code: string }>;
  analysis(item: BatchItemView): Promise<Pick<Analysis, "studio" | "runId" | "blueprintVersion" | "report"> | null>;
  readme: string;
  maxBytes: number;
}

/** A file name that survives every system: accents folded, no separator, no leading dot. */
export const safeName = (text: string): string =>
  trimEdges(
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\w.-]+/g, "-"),
    "-.",
  ).slice(0, 60) || "document";

const REPORTED = new Set<string>([BATCH_ITEM.done, BATCH_ITEM.reused]);

export interface ExportResult {
  bytes: Buffer;
  /** The names in the archive, in order. */
  files: string[];
  /** One entry per row: what it became in the archive. */
  rows: { line: number; file: string | null; reason: string | null }[];
}

export async function exportBatchZip(batch: BatchView, lang: "fr" | "en", deps: ExportDeps): Promise<ExportResult> {
  const modified = new Date(batch.finishedAt ?? batch.createdAt);
  const entries: ZipEntry[] = [];
  const rows: ExportResult["rows"] = [];
  // The budget is held as each file is added: an oversized batch stops rendering reports the moment it cannot fit (review of #265).
  let used = 0;
  const tooLarge = () =>
    refuse(413, "EXPORT_TOO_LARGE", "The archive would be larger than the limit", {
      bytes: used,
      limit: deps.maxBytes,
    });
  const add = (name: string, data: Uint8Array) => {
    used += data.length;
    if (used > deps.maxBytes) throw tooLarge();
    entries.push({ name, data, modified });
  };
  for (const item of batch.items) {
    const base = `${item.line}-${safeName(item.reference ?? item.file.replace(/\.[^.]+$/, ""))}`;
    if (!REPORTED.has(item.state)) {
      rows.push({ line: item.line, file: null, reason: item.error ?? item.state });
      continue;
    }
    const analysis = await deps.analysis(item);
    if (!analysis?.report) {
      rows.push({ line: item.line, file: null, reason: "REPORT_NOT_READY" });
      continue;
    }
    if (analysis.studio === "document-authenticity") {
      const name = `signaux/${base}.json`;
      add(
        name,
        Buffer.from(
          `${JSON.stringify({ file: item.file, reference: item.reference, sovkora: { runId: analysis.runId, studioVersion: analysis.blueprintVersion }, report: analysis.report }, null, 2)}\n`,
        ),
      );
      rows.push({ line: item.line, file: name, reason: null });
      continue;
    }
    const pdf = await deps.pdf(item);
    if ("code" in pdf) {
      rows.push({ line: item.line, file: null, reason: pdf.code });
      continue;
    }
    const name = `rapports/${base}-${lang}.pdf`;
    add(name, pdf.bytes);
    rows.push({ line: item.line, file: name, reason: null });
  }
  const table = [
    "line,file,reference,state,reason,report_file",
    ...batch.items.map((i) => {
      const row = rows.find((r) => r.line === i.line)!;
      return [i.line, i.file, i.reference, i.state, row.reason, row.file].map(csvCell).join(",");
    }),
  ];
  const all: ZipEntry[] = [
    { name: "lot.csv", data: Buffer.from(`\uFEFF${table.join("\r\n")}\r\n`), modified },
    { name: "LISEZ-MOI.txt", data: Buffer.from(deps.readme), modified },
    ...entries,
  ];
  used = all.reduce((sum, e) => sum + e.data.length, 0);
  if (used > deps.maxBytes) throw tooLarge();
  return { bytes: buildZip(all), files: all.map((e) => e.name), rows };
}
