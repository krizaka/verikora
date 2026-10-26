import { type PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

/*
 * The page layout the signed PDFs share (reports, sealed contracts): A4 with a margin, text wrapped to the width in the standard
 * fonts (WinAnsi), pages cut where the next line would cross the bottom margin, a folio on each. Pure and deterministic: the same
 * blocks give the same pages.
 */
export const PAGE = { w: 595.28, h: 841.89, margin: 56 };

/** What French typography and common symbols become where the standard fonts have no glyph: their plain equivalent, not « ? ». */
const FOLD: Record<string, string> = { "\u202f": " ", "\u2009": " ", "\u2002": " ", "\u2003": " ", "\u2011": "-", "\u2212": "-", "\u2192": "->", "\u2190": "<-", "\u2265": ">=", "\u2264": "<=", "\u2713": "ok", "\u2714": "ok", "\u2717": "x", "\u2715": "x", "\u2022": "\u2022" };
export const foldToWinAnsi = (text: string) => [...text].map((ch) => FOLD[ch] ?? ch).join("");

/** A PDF's standard fonts print WinAnsi: what has no plain equivalent becomes « ? » — in the signed text too, so both sides agree. */
export const printable = (text: string, font: PDFFont) => {
  const ok = font.getCharacterSet();
  return [...foldToWinAnsi(text.replace(/[\r\n\t]+/g, " "))].map((ch) => (ok.includes(ch.codePointAt(0)!) ? ch : "?")).join("");
};


export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (w: string) => {
    // A single token wider than the line (a hash) is cut where it stops fitting.
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let n = rest.length;
      while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n -= 1;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  };
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= width) line = test;
    else {
      if (line) lines.push(line);
      push(word);
    }
  }
  if (line) lines.push(line);
  return lines;
}


export type Face = "regular" | "bold" | "mono";
/** One printed line: where it goes on its page, and in what face. */
export interface PrintedLine {
  text: string;
  size: number;
  face: Face;
  y: number;
}

// @fixed: typography — the line height of the printed text, a multiple of its size
export const LINE_HEIGHT = 1.4;
/** The folio sits in the bottom margin, centred; the body stops above it. */
export const FOLIO = { size: 8, y: 30 };

/**
 * Lays blocks out on pages: each wrapped to the width, a new page when the next line would cross the bottom margin. The first page
 * keeps `reserve` points at its foot for the footnotes. Pure and deterministic: the same blocks give the same pages.
 */
export function paginate(blocks: ReadonlyArray<{ text: string; size: number; face: Face; gap: number }>, fonts: Record<Face, PDFFont>, reserve: number): PrintedLine[][] {
  const width = PAGE.w - PAGE.margin * 2;
  const pages: PrintedLine[][] = [[]];
  let y = PAGE.h - PAGE.margin;
  const floor = () => PAGE.margin + (pages.length === 1 ? reserve : 0);
  for (const b of blocks) {
    for (const text of wrap(b.text, fonts[b.face], b.size, width)) {
      if (y < floor() + b.size) {
        pages.push([]);
        y = PAGE.h - PAGE.margin;
      }
      pages.at(-1)!.push({ text, size: b.size, face: b.face, y });
      y -= b.size * LINE_HEIGHT;
    }
    y -= b.gap;
  }
  return pages;
}


/** The folio of a page: « 2 / 4 », language-free, so that it can be told from the report's text at verification. */
export const folio = (page: number, total: number) => `${page} / ${total}`;


export type Fonts = Record<Face, PDFFont>;

/** The three faces every signed PDF prints with: Helvetica, its bold and Courier (hashes, ids). */
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), mono: await doc.embedFont(StandardFonts.Courier) };
}

const INK = rgb(0.08, 0.09, 0.12);

/**
 * Draws laid-out pages: on each, the folio first (a page's text always starts with it — how verification tells it from the
 * words), then `foot` on the first page (its footnotes, lines already placed), then the lines.
 */
export function drawPages(doc: PDFDocument, fonts: Fonts, pages: readonly (readonly PrintedLine[])[], foot: readonly PrintedLine[] = []): void {
  for (const [index, lines] of pages.entries()) {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    const label = folio(index + 1, pages.length);
    page.drawText(label, { x: (PAGE.w - fonts.regular.widthOfTextAtSize(label, FOLIO.size)) / 2, y: FOLIO.y, size: FOLIO.size, font: fonts.regular, color: INK });
    for (const l of [...(index === 0 ? foot : []), ...lines]) page.drawText(l.text, { x: PAGE.margin, y: l.y, size: l.size, font: fonts[l.face], color: INK });
  }
}

/**
 * The text a signature covers, from what pdf.js extracted page by page: every page but the last (the signature page), each
 * starting with its own folio — which is checked, so a page moved or dropped is caught, and removed — with every whitespace
 * removed. Null when a folio is not the one of its place.
 */
export function signedBodyOf(pages: readonly string[]): string | null {
  const total = pages.length;
  const body = pages.slice(0, -1).map((p) => p.replace(/\s+/g, ""));
  if (body.some((p, i) => !p.startsWith(`${i + 1}/${total}`))) return null;
  return body.map((p, i) => p.slice(`${i + 1}/${total}`.length)).join("");
}
