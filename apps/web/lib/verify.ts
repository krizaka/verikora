import { refuse } from "./http";

export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The biggest body /api/verify reads: the report and the original document (nothing is kept — memory only). */
export const MAX_BODY_BYTES = MAX_REPORT_BYTES + MAX_DOCUMENT_BYTES + 64 * 1024;

const isHtmlReport = (file: File) => /\.html?$/i.test(file.name) || file.type === "text/html";
const isJsonReceipt = (file: File) => /\.json$/i.test(file.name) || file.type === "application/json";
const isPdfReport = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

/** The report: a file (.pdf or .html) or pasted text, within its bound. */
async function readReport(form: FormData): Promise<{ text: string; pdf: Uint8Array | null }> {
  const file = form.get("report");
  const pasted = form.get("reportText");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_REPORT_BYTES) {
      throw refuse(413, "FILE_TOO_LARGE", "The report is larger than 2 MB");
    }
    if (isPdfReport(file)) {
      return { text: "", pdf: new Uint8Array(await file.arrayBuffer()) };
    }
    if (isHtmlReport(file) || isJsonReceipt(file)) {
      return { text: await file.text(), pdf: null };
    }
    throw refuse(415, "UNSUPPORTED_TYPE", "An audit report is an .html or .pdf file, a deletion receipt a .json file");
  }
  if (typeof pasted === "string" && pasted.trim()) {
    if (pasted.length > MAX_REPORT_BYTES) {
      throw refuse(413, "FILE_TOO_LARGE", "The report is larger than 2 MB");
    }
    return { text: pasted, pdf: null };
  }
  throw refuse(400, "BAD_REQUEST", "Give a report file or its text");
}

/** The original document, when one is given, within its bound. */
async function readOriginal(form: FormData): Promise<Uint8Array | null> {
  const doc = form.get("document");
  if (!(doc instanceof File && doc.size > 0)) {
    return null;
  }
  if (doc.size > MAX_DOCUMENT_BYTES) {
    throw refuse(413, "FILE_TOO_LARGE", "The document is larger than 10 MB");
  }
  return new Uint8Array(await doc.arrayBuffer());
}

/**
 * What /api/verify receives from a signed-in member: the report as a file or as pasted text, and optionally the original
 * document's bytes. Everything is read in memory, checked and dropped: nothing is stored, nothing reaches a model
 * (verification is Ed25519 and SHA-256 only). Who may verify is decided before the signature is checked (lib/report-access.ts).
 */
export async function readVerifyForm(
  form: FormData,
): Promise<{ text: string; pdf: Uint8Array | null; document: Uint8Array | null }> {
  const { text, pdf } = await readReport(form);
  const document = await readOriginal(form);
  return { text, pdf, document };
}
