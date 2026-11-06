import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createImageCleaner } from "./clean";
import { estimateSkew } from "./deskew";
import { photoOfPage } from "./fixtures";
import { pagesToPdf } from "./pdf";
import { ImageError } from "./port";
import { VERIKORA_IMAGE_RULES } from "./rules";

const cleaner = createImageCleaner(VERIKORA_IMAGE_RULES);
const grayOf = async (jpeg: Uint8Array) => {
  const { data, info } = await sharp(jpeg)
    .resize({ width: 600 })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

describe("cleaning a photo", () => {
  it("turns a skewed page level, crops the desk away and drops every piece of metadata (Loi 25)", async () => {
    const { page } = await cleaner.clean({ bytes: await photoOfPage({ degrees: 6 }), kind: "jpeg" });
    expect(page.steps.cropped).toBe(true);
    expect(Math.abs(page.steps.skewDegrees + 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(estimateSkew(await grayOf(page.jpeg), { max: 12, step: 0.5 }))).toBeLessThanOrEqual(1);
    const meta = await sharp(page.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width!).toBeLessThan(1700); // the 240 px of desk around the page are gone
  });

  it("applies the camera's orientation", async () => {
    // orientation 6 = the phone was held on its side: the stored pixels are turned a quarter, the page must come out landscape.
    const { page, facts } = await cleaner.clean({ bytes: await photoOfPage({ orientation: 6 }), kind: "jpeg" });
    expect(page.steps.orientation).toBe(true);
    expect(facts.hadGps).toBe(true);
    expect(page.height).toBeGreaterThan(page.width);
  });

  it("reads where the photo comes from before dropping it: device, editor, GPS yes/no — never the position", async () => {
    const { facts } = await cleaner.clean({
      bytes: await photoOfPage({ editor: "Adobe Photoshop 25.0" }),
      kind: "jpeg",
    });
    expect(facts).toMatchObject({ software: "Adobe Photoshop 25.0", device: "Apple iPhone 15", hadGps: true });
    expect(JSON.stringify(facts)).not.toMatch(/45|73/);
  });

  it("reads a PNG, and a HEIC (decoded in WebAssembly)", async () => {
    const png = await cleaner.clean({ bytes: await photoOfPage({ format: "png" }), kind: "png" });
    expect(png.page.jpeg.length).toBeGreaterThan(1000);
    const heic = await cleaner.clean({
      bytes: new Uint8Array(readFileSync(join(__dirname, "samples", "page.heic"))),
      kind: "heic",
    });
    expect(heic.page.width).toBeGreaterThan(300);
    expect((await sharp(heic.page.jpeg).metadata()).exif).toBeUndefined();
  });

  it("is deterministic: the same photo gives the same page", async () => {
    const bytes = await photoOfPage({ degrees: -4 });
    const [a, b] = [await cleaner.clean({ bytes, kind: "jpeg" }), await cleaner.clean({ bytes, kind: "jpeg" })];
    expect(Buffer.from(a.page.jpeg).equals(Buffer.from(b.page.jpeg))).toBe(true);
  });

  it("refuses bytes that are not the image they claim, with a stable code", async () => {
    await expect(
      cleaner.clean({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4]), kind: "jpeg" }),
    ).rejects.toMatchObject({ code: "UNREADABLE_IMAGE" });
    await expect(cleaner.clean({ bytes: new Uint8Array(40), kind: "heic" })).rejects.toBeInstanceOf(ImageError);
  });
});

describe("several photos make one document", () => {
  it("a PDF with one page per photo, in order, and the same bytes for the same photos", async () => {
    const pages = [
      await cleaner.clean({ bytes: await photoOfPage({ degrees: 3 }), kind: "jpeg" }),
      await cleaner.clean({ bytes: await photoOfPage({ degrees: -2 }), kind: "jpeg" }),
    ].map((r) => r.page);
    const pdf = await pagesToPdf(pages);
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getProducer()).toContain("Verikora");
    expect(Buffer.from(await pagesToPdf(pages)).equals(Buffer.from(pdf))).toBe(true);
  });
});
