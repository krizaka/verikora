import { getAnalysis } from "../analyses";
import { audit } from "../audit";
import { HttpError } from "../http";
import { getDictionary, type Locale } from "../i18n";
import { reportPdfFor } from "../reports";
import { settingsFor } from "../settings/guards";
import { exportBatchZip } from "./export";
import { batchView } from "./run";

/** The ZIP of a batch's reports for its owner, wired to this app: the signed PDFs of `reportPdfFor`, the analyses, the limit and the README of the language. */
export async function batchZipFor(ownerId: string, batchId: string, lang: Locale) {
  const batch = await batchView(ownerId, batchId);
  const settings = await settingsFor(ownerId);
  const result = await exportBatchZip(batch, lang, {
    readme: getDictionary(lang).console.batch.exportReadme,
    maxBytes: (settings["limits.batchExportMaxMb"].value as number) * 1024 * 1024,
    analysis: async (item) =>
      item.documentId && item.analysisId ? getAnalysis(ownerId, item.documentId, item.analysisId) : null,
    pdf: async (item) => {
      try {
        return { bytes: (await reportPdfFor(ownerId, item.documentId!, item.analysisId!, lang)).issued.bytes };
      } catch (error) {
        if (error instanceof HttpError) {
          return { code: String((error.body as { code?: string }).code ?? "FAILED") };
        }
        throw error;
      }
    },
  });
  return { batch, ...result };
}

/** What an export is audited as, and by whom. */
type ZipAudit = { action: "batch.exported" | "api.batch.exported"; actorId: string; actorLabel: string };

/** The download of a batch's ZIP: the archive built for its owner, audited once, with the headers of an attachment that is never cached. */
export async function batchZipResponse(
  ownerId: string,
  batchId: string,
  lang: Locale,
  who: ZipAudit,
  headers: Headers,
) {
  const zip = await batchZipFor(ownerId, batchId, lang);
  await audit({
    ...who,
    targetId: batchId,
    detail: { files: zip.files.length, bytes: zip.bytes.length },
    headers,
  });
  return new Response(new Uint8Array(zip.bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="lot-${batchId.slice(0, 8)}-rapports.zip"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
