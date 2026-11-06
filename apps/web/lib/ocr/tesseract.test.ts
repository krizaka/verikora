import { describe, expect, it } from "vitest";

import { createImageCleaner } from "../images/clean";
import { photoOfPage } from "../images/fixtures";
import { VERIKORA_IMAGE_RULES } from "../images/rules";
import { OcrError } from "./port";
import { VERIKORA_OCR_RULES } from "./rules";
import { tesseractEngine } from "./tesseract";

/** The real engine (Tesseract, WebAssembly, fra + eng) on a cleaned photo of a fictional lease — free, local, no network. */
describe("tesseract engine", () => {
  const engine = tesseractEngine();
  it("reads a skewed photo of a lease in French, accents included, with its confidence", async () => {
    const { page } = await createImageCleaner(VERIKORA_IMAGE_RULES).clean({
      bytes: await photoOfPage({ degrees: 5 }),
      kind: "jpeg",
    });
    const r = await engine.read([page.jpeg], VERIKORA_OCR_RULES.languages);
    expect(r.text).toContain("BAIL DE LOGEMENT");
    expect(r.text).toMatch(/situé/);
    expect(r.text).toMatch(/1\s?150,00/);
    expect(r.confidence).toBeGreaterThan(80);
    expect(r.pages).toHaveLength(1);
  }, 60_000);
  it("reads several pages in order", async () => {
    const cleaner = createImageCleaner(VERIKORA_IMAGE_RULES);
    const a = (await cleaner.clean({ bytes: await photoOfPage(), kind: "jpeg" })).page.jpeg;
    const r = await engine.read([a, a], VERIKORA_OCR_RULES.languages);
    expect(r.pages).toHaveLength(2);
    expect(r.text.match(/BAIL DE LOGEMENT/g)).toHaveLength(2);
  }, 60_000);
  it("fails with a stable code on bytes that are not an image", async () => {
    await expect(engine.read([new Uint8Array([1, 2, 3])], VERIKORA_OCR_RULES.languages)).rejects.toBeInstanceOf(
      OcrError,
    );
  }, 60_000);
});
