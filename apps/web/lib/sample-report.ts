import { PDFDocument } from "pdf-lib";

import { readRecording } from "./recorded-runs";
import { buildPayload, sha256 } from "./report";
import { DEVELOPMENT_KEY_BASE64, parseSigningKey } from "./report-key";
import { reportLabels } from "./report-labels";
import { type IssuedPdf, issuePdf } from "./report-pdf";

/**
 * The sample report a manager receives when they say « send me one » (krizaka-internal#3119): the REAL compliance run Sovkora returned on the
 * sample file's lease (`fixtures/sample-file/recorded-run.json`, recorded by `scripts/sample-file/record.mjs`), turned into the signed PDF by the
 * same `buildPayload` / `issuePdf` as a member's report. Two things tell it apart, and both are in the signed text: « Dossier fictif —
 * démonstration » and « Version de développement » on the first page, and the development key (public, so it proves nothing about a real file).
 * It is a file we send, never a public route (ADR-0002: no signed artifact is served publicly).
 */
export async function sampleReportPdf(recording: unknown, leasePdf: Uint8Array, lang: "en" | "fr"): Promise<IssuedPdf> {
  const { analysis, document } = readRecording("tenant", recording);
  const pages = (await PDFDocument.load(leasePdf)).getPageCount();
  const payload = buildPayload(
    { ...document, sha256: sha256(leasePdf), sizeBytes: leasePdf.length, pages },
    analysis,
    lang,
  );
  return issuePdf({ ...payload, demo: true }, reportLabels(lang), parseSigningKey(DEVELOPMENT_KEY_BASE64, true));
}
