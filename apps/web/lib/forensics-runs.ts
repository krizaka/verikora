import type { TextRun } from "@yomizaka/core";
import { getDocumentProxy } from "unpdf";

/**
 * The port of slice 2 (krizaka-internal#6): « the text runs of a PDF, with their face, size and box ». The reader is pdf.js (through
 * unpdf, already how the text layer is read). Content-stream positions come from `getTextContent`; the face's real name from the
 * font object pdf.js loads while it reads the page's operators. Wiring it into the isolated worker (yomizaka#21) is slice 4: this
 * reader is not called by a request yet.
 */
export type TextRunReader = (bytes: Uint8Array) => Promise<TextRun[]>;

interface PdfItem {
  str: string;
  fontName: string;
  transform: number[];
  width: number;
  height: number;
}
const isItem = (item: unknown): item is PdfItem =>
  typeof item === "object" && item !== null && "str" in item && "transform" in item;

export const readTextRuns: TextRunReader = async (bytes) => {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const runs: TextRun[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      await page.getOperatorList();
      for (const item of content.items) {
        if (!isItem(item) || item.str.trim() === "") continue;
        const font = (page.commonObjs.get(item.fontName) as { name?: string } | undefined)?.name ?? item.fontName;
        runs.push({
          page: number,
          text: item.str,
          font,
          size: Math.round(Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) * 100) / 100,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width,
          height: item.height,
        });
      }
    }
    return runs;
  } finally {
    // unpdf's proxy may not carry destroy(); the isolated worker does the same.
    await (pdf as { destroy?: () => Promise<void> }).destroy?.();
  }
};
