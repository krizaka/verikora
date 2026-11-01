import { describe, expect, it } from "vitest";

import { analyseTextRuns, type TextRun, withTextRuns } from "./forensics-text";
import type { FraudReport } from "./forensics";

const run = (text: string, font: string, y: number, x = 100, page = 1, size = 10): TextRun => ({
  page,
  text,
  font,
  size,
  x,
  y,
  width: text.length * 5,
  height: size,
});

/** A pay stub: labels in one face, every amount in another one the same way. */
const cleanStub = (): TextRun[] => [
  run("Gross", "Arial", 700),
  run("2 400,00", "Arial-Mono", 700, 300),
  run("Tax", "Arial", 680),
  run("512,40", "Arial-Mono", 680, 300),
  run("Net", "Arial", 660),
  run("1 887,60", "Arial-Mono", 660, 300),
  run("YTD", "Arial", 640),
  run("9 600,00", "Arial-Mono", 640, 300),
];

describe("analyseTextRuns", () => {
  it("finds nothing on a document whose amounts share one face", () => {
    expect(analyseTextRuns(cleanStub())).toEqual([]);
  });

  it("flags the one amount typeset in another font, with its page and box", () => {
    const runs = cleanStub();
    runs[5] = run("1 887,60", "Helvetica", 660, 300);
    const found = analyseTextRuns(runs);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "font-mismatch", page: 1, bbox: { x: 300, y: 660, width: 40, height: 10 } });
    expect(found[0]?.evidence).toContain("Helvetica");
    expect(found[0]?.evidence).toContain("Arial-Mono");
  });

  it("flags an amount whose size differs from its neighbours'", () => {
    const runs = cleanStub();
    runs[3] = run("512,40", "Arial-Mono", 680, 300, 1, 12);
    expect(analyseTextRuns(runs)).toHaveLength(1);
  });

  it("does not judge a page with too few amounts to have a norm", () => {
    const runs = [run("Gross", "Arial", 700), run("2 400,00", "Arial-Mono", 700, 300), run("7,00", "Helvetica", 680, 300)];
    expect(analyseTextRuns(runs)).toEqual([]);
  });

  it("judges each page on its own", () => {
    const other = cleanStub().map((r) => ({ ...r, page: 2, font: r.font === "Arial-Mono" ? "Courier" : r.font }));
    expect(analyseTextRuns([...cleanStub(), ...other])).toEqual([]);
  });
});

describe("withTextRuns", () => {
  const base: FraudReport = { tamperScore: 0, anomalies: [], revisions: 1, producer: null };
  it("adds the anomalies and the score, capped at 100", () => {
    const runs = cleanStub();
    runs[5] = run("1 887,60", "Helvetica", 660, 300);
    const report = withTextRuns(base, runs);
    expect(report.anomalies).toHaveLength(1);
    expect(report.tamperScore).toBeGreaterThan(0);
    expect(withTextRuns({ ...base, tamperScore: 95 }, runs).tamperScore).toBe(100);
  });
  it("leaves a clean report as it was", () => {
    expect(withTextRuns(base, cleanStub())).toEqual(base);
  });
});
