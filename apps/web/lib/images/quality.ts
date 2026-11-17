import type { Gray } from "./deskew";

/**
 * Can this photo be read? Measured on the cleaned page, in grey, before its contrast is stretched (verikora#8). Three things a
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
  /** A row of the frame with at least this share of ink is part of a solid bar (a phone's toolbar), not text, and is not part of the page. */
  barInkShare: number;
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

/** The rows of the frame left once the solid dark bars along its top and bottom (a phone screenshot's toolbar) are peeled off. */
function pageRows(gray: Gray, rules: QualityRules): { y0: number; y1: number } {
  const { data, width, height } = gray;
  const solid = (y: number) => {
    let ink = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x]! < rules.inkLevel) {
        ink++;
      }
    }
    return ink >= width * rules.barInkShare;
  };
  const seam = Math.max(1, Math.round(height * rules.rim)); // the bar's antialiased edge is not the page
  let [y0, y1] = [0, height];
  while (y0 < y1 && solid(y0)) {
    y0++;
  }
  while (y1 > y0 && solid(y1 - 1)) {
    y1--;
  }
  if (y0 > 0) {
    y0 += seam;
  }
  if (y1 < height) {
    y1 -= seam;
  }
  return y1 > y0 ? { y0, y1 } : { y0: 0, y1: height };
}

/** The ink share of the thin band along each edge of the page (inside its bars); the largest. */
function edgeInk(gray: Gray, rules: QualityRules): number {
  const { data, width } = gray;
  const { y0, y1 } = pageRows(gray, rules);
  const bandX = Math.max(1, Math.round(width * rules.edgeBand));
  const bandY = Math.max(1, Math.round((y1 - y0) * rules.edgeBand));
  const share = (xa: number, xb: number, ya: number, yb: number) => {
    let ink = 0;
    let total = 0;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        total++;
        if (data[y * width + x]! < rules.inkLevel) ink++;
      }
    }
    return total ? ink / total : 0;
  };
  return Math.max(
    share(0, bandX, y0, y1),
    share(width - bandX, width, y0, y1),
    share(0, width, y0, y0 + bandY),
    share(0, width, y1 - bandY, y1),
  );
}

/** The page without its rim. */
function trimmed(gray: Gray, rim: number): Gray {
  const [dx, dy] = [Math.round(gray.width * rim), Math.round(gray.height * rim)];
  const [width, height] = [gray.width - 2 * dx, gray.height - 2 * dy];
  if (dx === 0 && dy === 0) return gray;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    data.set(gray.data.subarray((y + dy) * gray.width + dx, (y + dy) * gray.width + dx + width), y * width);
  return { data, width, height };
}

/**
 * `framed`: the page fills the frame (nothing was cropped away): only then can ink on an edge mean the text runs out of the photo.
 * A page cropped out of a desk has the crop's rim there instead.
 */
export function assessQuality(page: Gray, rules: QualityRules, framed: boolean): PhotoQuality {
  const gray = trimmed(page, rules.rim);
  return {
    sharpness: laplacianVariance(gray),
    glareShare: glareShare(gray, rules),
    edgeInk: framed ? edgeInk(gray, rules) : 0,
  };
}

/** The first thing wrong with a photo, or null when it can be read. A blur comes first: nothing else matters when the text has no edges. */
export function qualityProblem(quality: PhotoQuality, rules: QualityRules): QualityProblem | null {
  if (quality.sharpness < rules.minSharpness) return "BLURRY";
  if (quality.glareShare >= rules.maxGlareShare) return "GLARE";
  if (quality.edgeInk >= rules.maxEdgeInk) return "CUT_OFF";
  return null;
}
