import type { PhotoQuality, QualityRules } from "./quality";

/**
 * The PHOTO CLEANING port (ADR-0010). Generic on purpose — no import from this app, so another Krizaka product can lift the
 * folder. A photo of a document (PNG, JPEG, HEIC) goes in; a clean, upright, cropped page comes out, with its metadata
 * STRIPPED (Loi 25: GPS and device data never leave the intake) and only a few facts kept — whether a camera or an editor made it.
 * Deterministic, in-process, for nothing: no model, no network.
 */
export const PHOTO_KIND = { png: "png", jpeg: "jpeg", heic: "heic" } as const;
export type PhotoKind = (typeof PHOTO_KIND)[keyof typeof PHOTO_KIND];

export interface PhotoInput {
  bytes: Uint8Array;
  kind: PhotoKind;
}

/** The rules, as DATA (lib/images/rules.ts). */
export interface ImageRules {
  /** The longest side after cleaning, in pixels: enough for OCR, small enough for memory. */
  maxSide: number;
  jpegQuality: number;
  /** Photos that make one document. */
  maxPhotos: number;
  /** The largest skew corrected, in degrees, and the search step. */
  deskewMaxDegrees: number;
  deskewStepDegrees: number;
  /** A crop is applied only when the page fills at least this share of the frame (else the photo is left whole). */
  minPageShare: number;
  /** The gate: when a photo is too blurred, glared or cut off to be read (lib/images/quality.ts). */
  quality: QualityRules;
}

/** What a photo says about where it comes from — read before the metadata is dropped. Never a verdict. */
export interface PhotoFacts {
  software: string | null;
  /** « Apple iPhone 15 » — the device, as a label; never a serial number or a location. */
  device: string | null;
  takenAt: string | null;
  modifiedAt: string | null;
  /** Whether it carried a GPS position (the position itself is never kept). */
  hadGps: boolean;
}

export interface CleanedPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** What was done, for the record and the tests: the orientation applied from the camera, the skew corrected, whether it was cropped. */
  steps: { orientation: boolean; skewDegrees: number; cropped: boolean };
  /** How readable the page is — measured before its contrast is stretched. */
  quality: PhotoQuality;
}

export interface ImageCleaner {
  clean(input: PhotoInput): Promise<{ page: CleanedPage; facts: PhotoFacts }>;
}

export class ImageError extends Error {
  constructor(readonly code: "UNREADABLE_IMAGE" | "TOO_MANY_PHOTOS") {
    super(code);
  }
}
