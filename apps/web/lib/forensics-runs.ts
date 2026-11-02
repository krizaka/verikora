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
const isItem = (item: object): item is PdfItem => "str" in item && "transform" in item;

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

const readPage = async (pdf: Pdf, number: number): Promise<TextRun[]> => {
  const page = await pdf.getPage(number);
  const content = await page.getTextContent();
  await page.getOperatorList();
  const items: object[] = content.items;
  return items
    .filter((item): item is PdfItem => isItem(item) && item.str.trim() !== "")
    .map((item) => ({
      page: number,
      text: item.str,
      font: (page.commonObjs.get(item.fontName) as { name?: string } | undefined)?.name ?? item.fontName,
      size: Math.round(Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) * 100) / 100,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width,
      height: item.height,
    }));
};

export const readTextRuns: TextRunReader = async (bytes) => {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const runs: TextRun[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      runs.push(...(await readPage(pdf, number)));
    }
    return runs;
  } finally {
    // unpdf's proxy may not carry destroy(); the isolated worker does the same.
    await (pdf as { destroy?: () => Promise<void> }).destroy?.();
  }
};
