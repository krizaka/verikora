import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { getDocument, getFile } from "./documents";
import { createImageCleaner } from "./images/clean";
import { photoOfPage } from "./images/fixtures";
import { YOMIZAKA_IMAGE_RULES } from "./images/rules";
import type { OcrEngine, VisionReader } from "./ocr/port";
import { YOMIZAKA_OCR_RULES } from "./ocr/rules";
import { storePhotos } from "./photos";
import { cleanPdf } from "./preflight/fixtures";

/** Photos become one document through the real pre-flight, cleaner and PostgreSQL (CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…); the engine is a fake so this stays fast. */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;

const LEASE = "BAIL DE LOGEMENT\nLe locateur loue au locataire le logement situé au 123 rue Exemple.\nLoyer mensuel : 1 150,00 $ payable le premier du mois.";
const engine = (confidence: number): OcrEngine => ({ name: "tesseract", read: async (images) => ({ text: LEASE, confidence, pages: images.map(() => ({ text: LEASE, confidence })) }) });
const deps = (ocr: OcrEngine, vision: VisionReader | null = null) => ({ cleaner: createImageCleaner(YOMIZAKA_IMAGE_RULES), ocr, vision, ocrRules: YOMIZAKA_OCR_RULES, imageRules: YOMIZAKA_IMAGE_RULES });

describe.runIf(enabled)("photos become one document", () => {
  let owner = "";
  beforeAll(async () => {
    await migrate();
    const [row] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`photos-${Date.now()}@yomizaka.test`]);
    owner = row!.id;
  });
  const file = async (name: string, degrees: number, editor?: string) => ({ name, type: "image/jpeg", bytes: await photoOfPage({ degrees, editor }) });

  it("two photos make ONE PDF with two pages, the text read locally, the source and the photo's origin kept, no metadata in the stored bytes", async () => {
    const { summary, duplicate } = await storePhotos(owner, [await file("IMG_2041.jpg", 4, "Adobe Photoshop 25.0"), await file("IMG_2042.jpg", -3)], "auto", { deps: deps(engine(91)) });
    expect(duplicate).toBe(false);
    expect(summary).toMatchObject({ mimeType: "application/pdf", pages: 2, hasText: true, kind: "lease" });
    const detail = await getDocument(owner, summary.id);
    expect(detail.text).toContain("Loyer mensuel");
    expect(detail.textSource).toMatchObject({ kind: "ocr", engine: "tesseract", confidence: 91, photos: 2, lowConfidence: false, origin: { software: "Adobe Photoshop 25.0", device: "Apple iPhone 15", hadGps: true } });
    expect(JSON.stringify(detail.textSource)).not.toMatch(/45\/1|73\/1|latitude/i);
    const stored = (await getFile(owner, summary.id)).content;
    const pdf = await PDFDocument.load(stored, { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(2);
    expect(stored.includes(Buffer.from("Exif"))).toBe(false);
    expect(stored.includes(Buffer.from("iPhone"))).toBe(false);
  });

  it("the same photos again are the same document and the text is not read twice", async () => {
    const photos = [await file("a.jpg", 2)];
    let reads = 0;
    const counting: OcrEngine = {
      name: "tesseract",
      read: async (images, languages) => {
        reads++;
        return engine(90).read(images, languages);
      },
    };
    const first = await storePhotos(owner, photos, "auto", { deps: deps(counting) });
    const again = await storePhotos(owner, photos, "auto", { deps: deps(counting) });
    expect(again).toMatchObject({ duplicate: true, summary: { id: first.summary.id } });
    expect(reads).toBe(1);
  });

  it("keeps the recognised words as an invisible text layer on the photo, names the file kept by its own hash, and still recognises the same photos", async () => {
    const withWords: OcrEngine = {
      name: "tesseract",
      read: async (images) => ({ text: LEASE, confidence: 92, pages: images.map(() => ({ text: LEASE, confidence: 92, words: [{ text: "Loyer", bbox: { x0: 40, y0: 40, x1: 200, y1: 90 } }] })) }),
    };
    const photos = [await file("layer.jpg", 3)];
    const first = await storePhotos(owner, photos, "auto", { deps: deps(withWords) });
    const stored = (await getFile(owner, first.summary.id)).content;
    const [row] = await query<{ sha256: string; source_sha256: string | null }>("SELECT sha256, source_sha256 FROM documents WHERE id = $1", [first.summary.id]);
    expect(row!.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.sha256).not.toBe(row!.source_sha256);
    expect(createHash("sha256").update(stored).digest("hex")).toBe(row!.sha256);
    const again = await storePhotos(owner, photos, "auto", { deps: deps(withWords) });
    expect(again).toMatchObject({ duplicate: true, summary: { id: first.summary.id } });
  });

  it("refuses a photo too blurred to read, with what to do — before anything is stored or read", async () => {
    let reads = 0;
    const counting: OcrEngine = { name: "tesseract", read: async (images, languages) => (reads++, engine(90).read(images, languages)) };
    const sharpPhoto = await photoOfPage();
    const blurred = new Uint8Array(await sharp(sharpPhoto).blur(6).jpeg().toBuffer());
    await expect(storePhotos(owner, [{ name: "blur.jpg", type: "image/jpeg", bytes: blurred }], "auto", { deps: deps(counting) })).rejects.toMatchObject({ status: 422, body: { code: "PHOTO_BLURRY", photo: 1 } });
    expect(reads).toBe(0);
  });

  it("a low reading is flagged; with a model available it reads instead and is marked with its run", async () => {
    const low = await storePhotos(owner, [await file("low.jpg", 1)], "auto", { deps: deps(engine(35)) });
    expect((await getDocument(owner, low.summary.id)).textSource).toMatchObject({ kind: "ocr", lowConfidence: true, confidence: 35 });
    const vision: VisionReader = { read: async () => ({ text: LEASE, runId: "run-vision-1", model: "llava" }) };
    const viaModel = await storePhotos(owner, [await file("dark.jpg", -1)], "auto", { deps: deps(engine(35), vision) });
    expect((await getDocument(owner, viaModel.summary.id)).textSource).toMatchObject({ kind: "vision", by: "orazaka", runId: "run-vision-1", localConfidence: 35 });
  });

  it("refuses what is not a photo, too many photos and a corrupt photo, with stable codes", async () => {
    await expect(storePhotos(owner, [{ name: "bail.pdf", type: "application/pdf", bytes: await cleanPdf() }], "auto", { deps: deps(engine(90)) })).rejects.toMatchObject({ status: 415 });
    const many = await Promise.all(Array.from({ length: 13 }, (_, i) => file(`p${i}.jpg`, 0)));
    await expect(storePhotos(owner, many, "auto", { deps: deps(engine(90)) })).rejects.toMatchObject({ body: { code: "TOO_MANY_PHOTOS" } });
    await expect(storePhotos(owner, [{ name: "x.jpg", type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 9, 9, 9, 9, 9, 9, 9]) }], "auto", { deps: deps(engine(90)) })).rejects.toMatchObject({ body: { code: "UNREADABLE_IMAGE" } });
  });
});
