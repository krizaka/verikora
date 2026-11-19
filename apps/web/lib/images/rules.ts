import type { ImageRules } from "./port";

/** Verikora's photo rules — data. */
export const VERIKORA_IMAGE_RULES: ImageRules = {
  maxSide: 2400,
  jpegQuality: 85,
  cleanBudgetMs: 25_000,
  maxPhotos: 12,
  deskewMaxDegrees: 12,
  deskewStepDegrees: 0.5,
  minPageShare: 0.25,
  pageFinder: { sampleWidth: 400, whiteLevel: 250, minLineShare: 0.6, gapShare: 0.08, minPageShare: 0.15 },
  quality: {
    minSharpness: 100,
    maxGlareShare: 0.08,
    glareLevel: 250,
    glareMedianCeiling: 238,
    maxEdgeInk: 0.02,
    edgeBand: 0.02,
    inkLevel: 100,
    barInkShare: 0.75,
    rim: 0.015,
  },
};
