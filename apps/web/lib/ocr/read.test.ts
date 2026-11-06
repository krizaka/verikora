import { describe, expect, it, vi } from "vitest";

import type { OcrEngine, VisionReader } from "./port";
import { readPhotoText } from "./read";
import { VERIKORA_OCR_RULES } from "./rules";

const long = "Le locateur loue au locataire le logement situé au 123 rue Exemple, loyer mensuel 1 150,00 $.";
const engine = (text: string, confidence: number): OcrEngine => ({
  name: "tesseract",
  read: vi.fn(async () => ({ text, confidence, pages: [{ text, confidence }] })),
});
const vision = (answer: Awaited<ReturnType<VisionReader["read"]>>): VisionReader => ({
  read: vi.fn(async () => answer),
});
const images = [new Uint8Array([1])];

describe("reading the text of photos", () => {
  it("trusts the local engine when it is confident, and never calls the model", async () => {
    const v = vision({ text: "x", runId: "r", model: null });
    const r = await readPhotoText(images, { ocr: engine(long, 91.4), vision: v, rules: VERIKORA_OCR_RULES });
    expect(r.source).toEqual({
      kind: "ocr",
      engine: "tesseract",
      confidence: 91,
      photos: 1,
      lowConfidence: false,
      origin: null,
    });
    expect(v.read).not.toHaveBeenCalled();
  });

  it("asks the model only when the local confidence is low, and marks the answer as the model's, with its run id", async () => {
    const r = await readPhotoText(images, {
      ocr: engine(long, 41),
      vision: vision({ text: "Texte lu par le modèle", runId: "run-9", model: "llava" }),
      rules: VERIKORA_OCR_RULES,
    });
    expect(r.text).toBe("Texte lu par le modèle");
    expect(r.source).toEqual({
      kind: "vision",
      by: "sovkora",
      runId: "run-9",
      model: "llava",
      localConfidence: 41,
      photos: 1,
      origin: null,
    });
  });

  it("asks the model when there is almost no text, even if the engine is sure of it", async () => {
    const v = vision({ text: "plein de texte lu", runId: "r1", model: null });
    expect(
      (await readPhotoText(images, { ocr: engine("Bail", 95), vision: v, rules: VERIKORA_OCR_RULES })).source.kind,
    ).toBe("vision");
  });

  it("keeps the local text, flagged low-confidence, when no model is available or it fails", async () => {
    for (const v of [
      undefined,
      null,
      vision(null),
      { read: async () => Promise.reject(new Error("down")) } as VisionReader,
    ]) {
      const r = await readPhotoText(images, { ocr: engine(long, 41), vision: v, rules: VERIKORA_OCR_RULES });
      expect(r.text).toBe(long);
      expect(r.source).toMatchObject({ kind: "ocr", lowConfidence: true, confidence: 41 });
    }
  });

  it("carries where the photo comes from, for the panel and the note", async () => {
    const origin = { software: "Adobe Photoshop", device: null, takenAt: null, modifiedAt: null, hadGps: false };
    expect(
      (await readPhotoText(images, { ocr: engine(long, 90), rules: VERIKORA_OCR_RULES, origin })).source,
    ).toMatchObject({ origin });
  });
});
