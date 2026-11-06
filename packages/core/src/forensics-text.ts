import type { Anomaly, FraudReport } from "./forensics";

/**
 * Document forensics, slice 2 (krizaka-internal#6): the typography of a page's numbers. Pure: the text runs come from a reader
 * (a port, pdf.js in apps/web), never from here. A page whose amounts share one face and one size, and one amount that does
 * not, is a signal for a person to look at it, not a verdict.
 */
export interface TextRun {
  /** 1-based page. */
  page: number;
  text: string;
  /** The face's name as the file declares it. */
  font: string;
  size: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page needs this many amounts before it has a norm; fewer and nothing is judged. */
// @fixed: below four amounts a "usual" face is a coin toss, so no claim is made.
export const MIN_AMOUNTS_PER_PAGE = 4;
/** The share of a page's amounts the usual face must hold to be a norm. */
// @fixed: a majority of three in four, so a page printed in two faces by design is left alone.
export const NORM_SHARE = 0.75;
// @fixed: a size gap under half a point is rounding, not retyping.
const SIZE_TOLERANCE = 0.5;

const isAmount = (text: string): boolean => /\d/.test(text) && !/[a-z]{3,}/i.test(text);

function norm<T>(values: readonly T[]): { value: T; share: number } {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [value, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [T, number];
  return { value, share: count / values.length };
}

function pageAnomalies(page: number, amounts: readonly TextRun[]): Anomaly[] {
  if (amounts.length < MIN_AMOUNTS_PER_PAGE) {
    return [];
  }
  const font = norm(amounts.map((r) => r.font));
  const size = norm(amounts.map((r) => r.size));
  const found: Anomaly[] = [];
  for (const r of amounts) {
    const wrongFont = font.share >= NORM_SHARE && r.font !== font.value;
    const wrongSize = size.share >= NORM_SHARE && Math.abs(r.size - size.value) > SIZE_TOLERANCE;
    if (!wrongFont && !wrongSize) {
      continue;
    }
    const why = wrongFont
      ? `« ${r.text.trim()} » is set in ${r.font}, the other amounts of the page in ${font.value}`
      : `« ${r.text.trim()} » is set at ${r.size} pt, the other amounts of the page at ${size.value} pt`;
    found.push({
      kind: "font-mismatch",
      level: "unusual",
      page,
      bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
      evidence: why,
    });
  }
  return found;
}

export function analyseTextRuns(runs: readonly TextRun[]): Anomaly[] {
  const pages = [...new Set(runs.map((r) => r.page))].sort((a, b) => a - b);
  return pages.flatMap((page) =>
    pageAnomalies(
      page,
      runs.filter((r) => r.page === page && isAmount(r.text)),
    ),
  );
}

/** Adds the typography findings to a report read from the bytes. */
export function withTextRuns(report: FraudReport, runs: readonly TextRun[]): FraudReport {
  const found = analyseTextRuns(runs);
  if (found.length === 0) {
    return report;
  }
  return {
    ...report,
    anomalies: [...report.anomalies, ...found],
  };
}
