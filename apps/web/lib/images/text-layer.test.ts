import { locateQuote, type PageText, type TextItem } from "@krizaka/ui/document-viewer";
import { describe, expect, it } from "vitest";

import { YOMIZAKA_OCR_RULES } from "../ocr/rules";
import { tesseractEngine } from "../ocr/tesseract";
import { createImageCleaner } from "./clean";
import { photoOfPage } from "./fixtures";
import { pagesToPdf } from "./pdf";
import { YOMIZAKA_IMAGE_RULES } from "./rules";

/** A photo's recognised words, laid invisibly on the page, are what lights a finding on the photo (yomizaka#8): the same text positions as a text PDF. */
async function textLayer(pdf: Uint8Array): Promise<PageText[]> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(pdf.slice());
  const pages: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ page: n, width: vp.width, height: vp.height, items: content.items.filter((i): i is typeof i & TextItem => "str" in i) as TextItem[] });
  }
  return pages;
}

describe("the recognised words of a photo, as the text layer of its PDF", () => {
  it("finds a quote on the photo, where the words are", async () => {
    const { page } = await createImageCleaner(YOMIZAKA_IMAGE_RULES).clean({ bytes: await photoOfPage(), kind: "jpeg" });
    const read = await tesseractEngine().read([page.jpeg], YOMIZAKA_OCR_RULES.languages);
    const words = read.pages[0]!.words!;
    expect(words.length).toBeGreaterThan(10);

    const pdf = await pagesToPdf([page], [words]);
    const pages = await textLayer(pdf);
    const found = locateQuote(pages, "Loyer mensuel");
    expect(found).not.toBeNull();
    expect(found!.page).toBe(1);

    // The box lies over the line « Loyer mensuel… » of the photo: compare with where the OCR saw the word, in the page's own units.
    const first = words.find((w) => w.text.startsWith("Loyer"))!;
    const scale = pages[0]!.width / page.width;
    const [top, bottom] = [first.bbox.y0 * scale, first.bbox.y1 * scale];
    const box = found!.boxes[0]!;
    const centre = (box.y + box.height / 2) * pages[0]!.height;
    expect(centre).toBeGreaterThan(top - 4);
    expect(centre).toBeLessThan(bottom + 4);
  }, 90_000);

  it("adds nothing without words: the same photos give the same bytes", async () => {
    const { page } = await createImageCleaner(YOMIZAKA_IMAGE_RULES).clean({ bytes: await photoOfPage(), kind: "jpeg" });
    expect(Buffer.from(await pagesToPdf([page])).equals(Buffer.from(await pagesToPdf([page], [[]])))).toBe(true);
    expect(await textLayer(await pagesToPdf([page]))).toEqual([expect.objectContaining({ items: [] })]);
  });

  it("draws what the standard font cannot as a question mark, never failing", async () => {
    const { page } = await createImageCleaner(YOMIZAKA_IMAGE_RULES).clean({ bytes: await photoOfPage(), kind: "jpeg" });
    const pdf = await pagesToPdf([page], [[{ text: "→ œuvre", bbox: { x0: 10, y0: 10, x1: 200, y1: 40 } }]]);
    expect((await textLayer(pdf))[0]!.items.map((i) => i.str).join("")).toContain("œuvre");
  });
});
