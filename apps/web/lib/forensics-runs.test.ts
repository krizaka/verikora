import { analyseTextRuns } from "@yomizaka/core";
import { describe, expect, it } from "vitest";

import { fixture } from "./forensics-fixture";
import { readTextRuns } from "./forensics-runs";

const stub = (lastFont: string) =>
  fixture([
    ["F1", 72, 700, 10, "Gross"],
    ["F2", 300, 700, 10, "2400.00"],
    ["F2", 300, 680, 10, "512.40"],
    ["F2", 300, 660, 10, "100.00"],
    [lastFont, 300, 640, 10, "1887.60"],
  ]);

describe("readTextRuns (pdf.js)", () => {
  it("reads the face name, size and position of each run", async () => {
    const runs = await readTextRuns(stub("F2"));
    const gross = runs.find((r) => r.text === "Gross");
    expect(gross).toMatchObject({ page: 1, font: "Helvetica", size: 10, x: 72, y: 700 });
    expect(runs.find((r) => r.text === "2400.00")?.font).toBe("Courier");
  });

  it("a stub whose amounts share one face is clean", async () => {
    expect(analyseTextRuns(await readTextRuns(stub("F2")))).toEqual([]);
  });

  it("a stub with one amount retyped in another face is flagged on that amount", async () => {
    const found = analyseTextRuns(await readTextRuns(stub("F1")));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "font-mismatch", page: 1, bbox: { x: 300, y: 640 } });
    expect(found[0]?.evidence).toContain("Helvetica");
  });
});
