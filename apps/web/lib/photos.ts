import type { DocumentKind, DocumentSummary, PhotoOrigin } from "@yomizaka/core";

import { inspectUpload, type StoragePolicy, storeDocument } from "./documents";
import { refuse } from "./http";
import { createImageCleaner, type ImageCleaner, ImageError, type ImageRules, pagesToPdf, type PhotoFacts, type PhotoKind, type QualityProblem, qualityProblem, YOMIZAKA_IMAGE_RULES } from "./images";
import { logError } from "./log";
import { type OcrEngine, type OcrRules, readPhotoText, tesseractEngine, type VisionReader, YOMIZAKA_OCR_RULES } from "./ocr";
import { sniff } from "./preflight/inspector";
import type { PreflightRules } from "./preflight/port";
import { YOMIZAKA_RULES } from "./preflight/rules";

/**
 * Photos of a document become ONE document (ADR-0010): each is checked by the pre-flight (real type by its bytes, pixel limit),
 * cleaned (orientation, skew, crop, metadata dropped), assembled into a PDF, and its text is read locally (Tesseract); a model
 * reads it instead only when the local reading is not reliable and one is configured. The stored file is the clean PDF — the
 * original photos, with their GPS and device data, are never kept.
 */
export interface PhotoFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface PhotoDeps {
  cleaner: ImageCleaner;
  ocr: OcrEngine;
  /** Orazaka's vision model, when a Studio for it is configured. None today: the local reading stands, flagged when it is weak. */
  vision: VisionReader | null;
  ocrRules: OcrRules;
  imageRules: ImageRules;
}

export const defaultPhotoDeps = (): PhotoDeps => ({ cleaner: createImageCleaner(YOMIZAKA_IMAGE_RULES), ocr: tesseractEngine(), vision: null, ocrRules: YOMIZAKA_OCR_RULES, imageRules: YOMIZAKA_IMAGE_RULES });

/** The code the page translates (messages `console.errors.*`) for each thing a photo can be refused for. */
export const PHOTO_QUALITY_CODE: Record<QualityProblem, string> = { BLURRY: "PHOTO_BLURRY", GLARE: "PHOTO_GLARE", CUT_OFF: "PHOTO_CUT_OFF" };

const IMAGE_KINDS = new Set<string>(["png", "jpeg", "heic"]);

/** Whether the bytes are a photo (PNG, JPEG, HEIC) — by their signature, never the name or the type the browser declared. */
export const isPhoto = (bytes: Uint8Array): boolean => IMAGE_KINDS.has(sniff(bytes));

/** Where the photos come from, as one record: the first value found on any photo, GPS if any carried it. */
function originOf(all: readonly PhotoFacts[]): PhotoOrigin | null {
  const pick = <K extends "software" | "device" | "takenAt" | "modifiedAt">(key: K) => all.map((f) => f[key]).find(Boolean) ?? null;
  const origin = { software: pick("software"), device: pick("device"), takenAt: pick("takenAt"), modifiedAt: pick("modifiedAt"), hadGps: all.some((f) => f.hadGps) };
  return origin.software || origin.device || origin.takenAt || origin.modifiedAt || origin.hadGps ? origin : null;
}

export async function storePhotos(ownerId: string, files: readonly PhotoFile[], requested: DocumentKind | "auto", options: { policy?: StoragePolicy; deps?: PhotoDeps } = {}): Promise<{ summary: DocumentSummary; duplicate: boolean }> {
  const deps = options.deps ?? defaultPhotoDeps();
  const rules: PreflightRules = options.policy?.rules ?? YOMIZAKA_RULES;
  if (files.length === 0) throw refuse(400, "BAD_REQUEST", "At least one photo is expected");
  if (files.length > deps.imageRules.maxPhotos) throw refuse(422, "TOO_MANY_PHOTOS", `At most ${deps.imageRules.maxPhotos} photos make one document`);

  const cleaned: Awaited<ReturnType<ImageCleaner["clean"]>>[] = [];
  for (const [index, file] of files.entries()) {
    const { fileKind } = await inspectUpload({ name: file.name, type: file.type, size: file.bytes.length }, file.bytes, rules);
    if (!IMAGE_KINDS.has(fileKind)) throw refuse(415, "UNSUPPORTED_TYPE", "Photos only: a PDF or a text file is sent on its own");
    try {
      cleaned.push(await deps.cleaner.clean({ bytes: file.bytes, kind: fileKind as PhotoKind }));
    } catch (error) {
      throw error instanceof ImageError ? refuse(422, error.code, "This photo cannot be read") : error;
    }
    // The quality gate (yomizaka#8): a photo too blurred, glared or cut off is refused with what to do, before anything is stored or read.
    const problem = qualityProblem(cleaned.at(-1)!.page.quality, deps.imageRules.quality);
    if (problem) throw refuse(422, PHOTO_QUALITY_CODE[problem], `Photo ${index + 1} cannot be read: ${problem}`, { photo: index + 1 });
  }

  const pdf = await pagesToPdf(cleaned.map((c) => c.page));
  const origin = originOf(cleaned.map((c) => c.facts));
  const name = `${files[0]!.name.replace(/\.[^.]+$/, "") || "photo"}.pdf`;
  // The photos' own pre-flight has passed; the PDF made of them is held to the same size and page limits, whatever kinds the workspace allows.
  const policy = options.policy ? { ...options.policy, rules: { ...rules, allowedKinds: [...new Set([...rules.allowedKinds, "pdf" as const])] } } : undefined;
  return storeDocument(ownerId, { name, type: "application/pdf", size: pdf.length }, pdf, requested, policy, async () => {
    try {
      const read = await readPhotoText(cleaned.map((c) => c.page.jpeg), { ocr: deps.ocr, vision: deps.vision, rules: deps.ocrRules, origin });
      // The file kept carries the recognised words, invisible, where they sit on each photo: a finding's passage is lit on the photo
      // like on a text PDF (yomizaka#8). Its identity (duplicates) stays that of the photos alone.
      return { text: read.text, source: read.source, ...(read.words?.some((w) => w.length) ? { file: await pagesToPdf(cleaned.map((c) => c.page), read.words) } : {}) };
    } catch (error) {
      logError("[yomizaka] reading a photo failed:", error);
      throw refuse(422, "OCR_FAILED", "The text of this photo could not be read");
    }
  });
}
