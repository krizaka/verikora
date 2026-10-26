import type { Gray } from "./deskew";

/**
 * Can this photo be read? Measured on the cleaned page, in grey, before its contrast is stretched (yomizaka#8). Three things a
 * reader loses a document to: a blur (the text has no edges), a glare (a flash or a window washed the paper out) and a page cut off
 * by the frame (the text runs out of the photo). Deterministic, in-process, no model.
 */
export interface PhotoQuality {
  /** Variance of the Laplacian on a page 1 000 px wide: sharp text is in the hundreds, a blurred page near zero. */
  sharpness: number;
  /** Share of the page washed out to white by a light, when the rest of the paper is visibly darker (0 when the page is evenly white, as a scan is). */
  glareShare: number;
  /** Share of dark ink in the thin band along the most inked edge of a page that fills the frame (0 for a page cropped out of a desk): text runs out of the frame when it is not a few percent. */
  edgeInk: number;
}

/** The thresholds of the gate — data. */
export interface QualityRules {
  /** Below this sharpness the page is too blurred to read. */
  minSharpness: number;
  /** At or above this share of glare the page is refused. */
  maxGlareShare: number;
  /** A pixel at or above this level is « washed out ». */
  glareLevel: number;
  /** Glare counts only when the page's median level is at most this (paper lit evenly white is not glare). */
  glareMedianCeiling: number;
  /** At or above this share of ink on one edge's band the page is cut off. */
  maxEdgeInk: number;
  /** The band along an edge, as a share of the page's side. */
  edgeBand: number;
  /** A pixel below this level is ink. */
  inkLevel: number;
  /** The rim of the cleaned page, as a share of its side, left out of every measure (the crop's last pixels, a shadow). */
  rim: number;
}

export type QualityProblem = "BLURRY" | "GLARE" | "CUT_OFF";

export function laplacianVariance(gray: Gray): number {
  const { data, width, height } = gray;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - width]! - data[i + width]!;
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

function median(values: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const v of values) histogram[v]!++;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level]!;
    if (seen * 2 >= values.length) return level;
  }
  return 255;
}

function glareShare(gray: Gray, rules: QualityRules): number {
  if (median(gray.data) > rules.glareMedianCeiling) return 0;
  let washed = 0;
  for (const v of gray.data) if (v >= rules.glareLevel) washed++;
  return washed / gray.data.length;
}

/** The ink share of the thin band along each edge; the largest. */
function edgeInk(gray: Gray, rules: QualityRules): number {
  const { data, width, height } = gray;
  const bandX = Math.max(1, Math.round(width * rules.edgeBand));
  const bandY = Math.max(1, Math.round(height * rules.edgeBand));
  const share = (x0: number, x1: number, y0: number, y1: number) => {
    let ink = 0;
    let total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        total++;
        if (data[y * width + x]! < rules.inkLevel) ink++;
      }
    }
    return total ? ink / total : 0;
  };
  return Math.max(share(0, bandX, 0, height), share(width - bandX, width, 0, height), share(0, width, 0, bandY), share(0, width, height - bandY, height));
}

/** The page without its rim. */
function trimmed(gray: Gray, rim: number): Gray {
  const [dx, dy] = [Math.round(gray.width * rim), Math.round(gray.height * rim)];
  const [width, height] = [gray.width - 2 * dx, gray.height - 2 * dy];
  if (dx === 0 && dy === 0) return gray;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) data.set(gray.data.subarray((y + dy) * gray.width + dx, (y + dy) * gray.width + dx + width), y * width);
  return { data, width, height };
}

/**
 * `framed`: the page fills the frame (nothing was cropped away): only then can ink on an edge mean the text runs out of the photo.
 * A page cropped out of a desk has the crop's rim there instead.
 */
export function assessQuality(page: Gray, rules: QualityRules, framed: boolean): PhotoQuality {
  const gray = trimmed(page, rules.rim);
  return { sharpness: laplacianVariance(gray), glareShare: glareShare(gray, rules), edgeInk: framed ? edgeInk(gray, rules) : 0 };
}

/** The first thing wrong with a photo, or null when it can be read. A blur comes first: nothing else matters when the text has no edges. */
export function qualityProblem(quality: PhotoQuality, rules: QualityRules): QualityProblem | null {
  if (quality.sharpness < rules.minSharpness) return "BLURRY";
  if (quality.glareShare >= rules.maxGlareShare) return "GLARE";
  if (quality.edgeInk >= rules.maxEdgeInk) return "CUT_OFF";
  return null;
}
