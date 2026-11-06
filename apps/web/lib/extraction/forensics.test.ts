import { describe, expect, it } from "vitest";

import { fixture } from "../forensics-fixture";
import { examinePdf } from "./forensics";

const stub = (lastFont: string) =>
  fixture([
    ["F1", 72, 700, 10, "Gross"],
    ["F2", 300, 700, 10, "2400.00"],
    ["F2", 300, 680, 10, "512.40"],
    ["F2", 300, 660, 10, "100.00"],
    [lastFont, 300, 640, 10, "1887.60"],
  ]);

describe("examinePdf (the isolated worker feeds the forensics)", () => {
  it("reports an amount retyped in another face as unusual, with its box, and gives no score", async () => {
    const report = await examinePdf(stub("F1"), "payroll");
    expect(report).not.toHaveProperty("tamperScore");
    expect(report.anomalies).toHaveLength(1);
    expect(report.anomalies[0]).toMatchObject({
      kind: "font-mismatch",
      level: "unusual",
      page: 1,
      bbox: { x: 300, y: 640 },
    });
  });

  it("finds nothing on a stub whose amounts share one face", async () => {
    expect((await examinePdf(stub("F2"), "payroll")).anomalies).toEqual([]);
  });
});
