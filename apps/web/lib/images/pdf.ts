import { beginText, endText, PDFDocument, type PDFFont, type PDFPage, setCharacterSqueeze, setFontAndSize, setTextMatrix, setTextRenderingMode, showText, StandardFonts, TextRenderingMode } from "pdf-lib";

import type { CleanedPage } from "./port";

const LETTER = { width: 612, height: 792 };
const FIXED_DATE = new Date("2000-01-01T00:00:00Z");

/** A word to place on a page image, in the image's pixels (origin top left): the invisible text layer a viewer finds passages in. */
export interface PageWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** The text a standard font can draw: anything its encoding lacks becomes a question mark (the layer is for finding, not for reading). */
function drawable(font: PDFFont, text: string): string {
  return [...text].map((c) => { try { font.encodeText(c); return c; } catch { return "?"; } }).join("");
}

/**
 * Lays each word invisibly (text rendering mode 3) over the photo where it was recognised, stretched to the width of its box:
 * the PDF then answers to the same text positions as a text PDF, so a finding's passage is lit on the photo (yomizaka#8).
 * Image pixels become PDF points by the page's own scale; the baseline sits a little above the box's bottom.
 */
function addTextLayer(page: PDFPage, font: PDFFont, words: readonly PageWord[], scale: number): void {
  const key = page.node.newFontDictionary(font.name, font.ref);
  const height = page.getHeight();
  for (const word of words) {
    const text = drawable(font, word.text);
    const [boxWidth, boxHeight] = [(word.bbox.x1 - word.bbox.x0) * scale, (word.bbox.y1 - word.bbox.y0) * scale];
    if (!text || boxWidth <= 0 || boxHeight <= 0) continue;
    const size = Math.max(4, boxHeight * 0.85);
    const natural = font.widthOfTextAtSize(text, size);
    if (natural <= 0) continue;
    page.pushOperators(
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(key, size),
      setCharacterSqueeze((boxWidth / natural) * 100),
      setTextMatrix(1, 0, 0, 1, word.bbox.x0 * scale, height - word.bbox.y1 * scale + boxHeight * 0.2),
      showText(font.encodeText(text)),
      endText(),
    );
  }
}

/**
 * Several cleaned pages make ONE document: a PDF, one page per photo, in the order given. Deterministic — no clock, no random
 * identifier — so the same photos give the same bytes (and the pre-flight's duplicate check recognises them). Its producer says
 * what it is, so nobody mistakes it for a document someone else issued.
 */
export async function pagesToPdf(pages: readonly CleanedPage[], words: ReadonlyArray<readonly PageWord[] | undefined> = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("Yomizaka (photos assembled into one document)");
  doc.setCreator("Yomizaka");
  doc.setTitle("");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = words.some((w) => w?.length) ? await doc.embedFont(StandardFonts.Helvetica) : null;
  for (const [index, p] of pages.entries()) {
    const image = await doc.embedJpg(p.jpeg);
    const scale = Math.min(LETTER.width / image.width, LETTER.height / image.height);
    const [w, h] = [image.width * scale, image.height * scale];
    const page = doc.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    const layer = words[index];
    if (font && layer?.length) addTextLayer(page, font, layer, scale);
  }
  return doc.save({ useObjectStreams: false });
}
