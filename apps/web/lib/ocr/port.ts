/**
 * The OCR ports (ADR-0010). Generic on purpose — no import from this app, so another Krizaka product can lift the folder.
 * `OcrEngine` reads text out of cleaned page images locally, for nothing (Tesseract, fra + eng). `VisionReader` is the
 * fallback a product may supply (Orazaka's vision model) for what the local engine cannot read; it is asked only when the
 * local confidence is low, and what it returns is always marked as such. Neither ever decides what the text means.
 */
/** One recognised word and where it sits on the page image, in the image's pixels (origin top left). */
export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPage {
  text: string;
  /** 0–100, as the engine reports it. */
  confidence: number;
  /** The words with their boxes, in reading order: what lets a finding be lit on the photo (an invisible text layer in the stored PDF). */
  words?: OcrWord[];
}

export interface OcrResult {
  text: string;
  /** 0–100, over the whole document (pages weighted by the amount of text). */
  confidence: number;
  pages: OcrPage[];
}

export interface OcrEngine {
  readonly name: string;
  read(images: readonly Uint8Array[], languages: readonly string[]): Promise<OcrResult>;
}

/** A model's reading of the pages, with the run that produced it. Null: the fallback is not available (not an error). */
export interface VisionResult {
  text: string;
  runId: string;
  model: string | null;
}
export interface VisionReader {
  read(images: readonly Uint8Array[], languages: readonly string[]): Promise<VisionResult | null>;
}

/** The rules, as DATA (lib/ocr/rules.ts). */
export interface OcrRules {
  languages: readonly string[];
  /** Below this confidence (or fewer characters than `minChars`) the local reading is not trusted. */
  minConfidence: number;
  minChars: number;
}

/** Where a document's text came from, kept with the document and shown wherever it is shown (« Ce document », the closing note). */
export interface PhotoOrigin {
  software: string | null;
  device: string | null;
  takenAt: string | null;
  modifiedAt: string | null;
  hadGps: boolean;
}

export type TextSource =
  | { kind: "ocr"; engine: string; confidence: number; photos: number; lowConfidence: boolean; origin: PhotoOrigin | null }
  | { kind: "vision"; by: "orazaka"; runId: string; model: string | null; localConfidence: number; photos: number; origin: PhotoOrigin | null };

export class OcrError extends Error {
  constructor(
    readonly code: "OCR_FAILED" | "OCR_TIMEOUT",
    cause?: unknown,
  ) {
    super(code, { cause });
  }
}
