import { type AcceptedType, DOCX_MIME, ODT_MIME } from "@verikora/core";

import { docxText, odtText } from "./docx-text";
import { extractPdfText } from "./extraction/isolated";
/**
 * Reading a file's text layer — deterministic parsing, no model: a PDF's embedded text (pdf.js, through unpdf) or a text
 * file as UTF-8. It is the input of Sovkora's compliance Studio and of search. A scanned PDF has no text layer: `text`
 * is empty and the page says so (reading an image is an analysis — it would be Sovkora's, never done here).
 */
export interface ReadText {
  text: string;
  pages: number | null;
}

/** Collapses the PDF's layout whitespace, keeps line breaks (a clause stays on its line). */
export function normaliseText(raw: string): string {
  return (
    raw
      // Unicode NFC: a combining accent joins its letter (a PDF's text layer often has "e" + U+0301). œ and æ are letters and stay.
      .normalize("NFC")
      // Presentation ligatures (ﬁ ﬂ ﬀ ﬃ ﬄ…) are glyph shortcuts: as letters the text can be searched and quoted.
      .replace(/[\uFB00-\uFB06]/g, (c) => c.normalize("NFKC"))
      // Zero-width characters split words invisibly.
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\f\v\u00a0]+/g, " ")
      .replace(/ {2,}/g, " ")
      // Runs of spaces are already one by now: at most one is next to a line break.
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export async function readText(mimeType: AcceptedType, bytes: Uint8Array): Promise<ReadText> {
  if (mimeType === DOCX_MIME) {
    return { text: normaliseText(docxText(bytes)), pages: null };
  }
  if (mimeType === ODT_MIME) {
    return { text: normaliseText(odtText(bytes)), pages: null };
  }
  if (mimeType === "text/plain") {
    return { text: normaliseText(new TextDecoder("utf-8", { fatal: false }).decode(bytes)), pages: null };
  }
  // Off the web process: an isolated worker with its own heap, deadline and page ceiling (verikora#21).
  const { text, pages } = await extractPdfText(bytes);
  return { text: normaliseText(text), pages };
}

/** A PDF starts with `%PDF-` — what is checked, not what the browser declared. */
export const looksLikePdf = (bytes: Uint8Array) =>
  bytes.length > 5 && String.fromCodePoint(...bytes.slice(0, 5)) === "%PDF-";
