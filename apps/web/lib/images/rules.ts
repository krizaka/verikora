import type { ImageRules } from "./port";

/** Yomizaka's photo rules — data. */
export const YOMIZAKA_IMAGE_RULES: ImageRules = {
  maxSide: 2400,
  jpegQuality: 85,
  maxPhotos: 12,
  deskewMaxDegrees: 12,
  deskewStepDegrees: 0.5,
  minPageShare: 0.25,
  quality: { minSharpness: 100, maxGlareShare: 0.08, glareLevel: 250, glareMedianCeiling: 238, maxEdgeInk: 0.02, edgeBand: 0.02, inkLevel: 100, rim: 0.015 },
};
