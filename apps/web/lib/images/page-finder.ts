import type { Box, Gray } from "./deskew";

/** The page finder's thresholds — data (lib/images/rules.ts). */
export interface PageFinderRules {
  /** The width of the copy the page is found on, in pixels. */
  sampleWidth: number;
  /** A pixel at or above this grey level is « page white ». */
  whiteLevel: number;
  /** A row or a column is part of the page when at least this share of its pixels is page white. */
  minLineShare: number;
  /** A gap of rows or columns up to this share of the side is bridged (the blank line between two lines of text). */
  gapShare: number;
  /** The page found must cover at least this share of the frame. */
  minPageShare: number;
}

/** The longest run of `true`, bridging gaps of at most `gap` entries; null when there is none. */
function longestRun(flags: readonly boolean[], gap: number): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null;
  let current: { from: number; to: number } | null = null;
  let hole = 0;
  flags.forEach((on, i) => {
    if (on) {
      current = current && hole <= gap ? { from: current.from, to: i } : { from: i, to: i };
      hole = 0;
      if (!best || current.to - current.from > best.to - best.from) {
        best = current;
      }
    } else {
      hole++;
    }
  });
  return best;
}

/**
 * The page of a RENDERED page — a phone screenshot of a document, whose viewer's grey, black bars and the page are all « bright »
 * to a photo crop: the largest near-white rectangle, made of the rows and then the columns that are mostly page white. Null when
 * there is none, it touches the frame (it fills the screen or is cut off by it) or is less than `minPageShare` of it. Measured on the small copy.
 */
export function findPage(gray: Gray, rules: PageFinderRules): Box | null {
  const { data, width, height } = gray;
  const white = (x: number, y: number) => data[y * width + x]! >= rules.whiteLevel;
  const rowFlags = Array.from({ length: height }, (_, y) => {
    let n = 0;
    for (let x = 0; x < width; x++) {
      if (white(x, y)) {
        n++;
      }
    }
    return n >= width * rules.minLineShare;
  });
  const rows = longestRun(rowFlags, Math.round(height * rules.gapShare));
  if (!rows) {
    return null;
  }
  const span = rows.to - rows.from + 1;
  const colFlags = Array.from({ length: width }, (_, x) => {
    let n = 0;
    for (let y = rows.from; y <= rows.to; y++) {
      if (white(x, y)) {
        n++;
      }
    }
    return n >= span * rules.minLineShare;
  });
  const cols = longestRun(colFlags, Math.round(width * rules.gapShare));
  if (!cols) {
    return null;
  }
  const share = ((cols.to - cols.from + 1) * span) / (width * height);
  // A page that touches the frame is not framed by a viewer: it fills the screen or runs out of it, for the gate to judge.
  const inside = cols.from > 0 && cols.to < width - 1 && rows.from > 0 && rows.to < height - 1;
  if (share < rules.minPageShare || !inside) {
    return null;
  }
  return { left: cols.from, top: rows.from, right: cols.to, bottom: rows.to };
}
