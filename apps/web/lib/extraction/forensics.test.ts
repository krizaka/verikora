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

  it("adds the arithmetic of a pay stub's figures, only for a payroll document", async () => {
    const lines = [
      ["F1", 72, 700, 10, "Salaire brut"],
      ["F2", 300, 700, 10, "3400.00"],
      ["F1", 72, 680, 10, "Total des retenues"],
      ["F2", 300, 680, 10, "512.40"],
      ["F1", 72, 660, 10, "Salaire net"],
      ["F2", 300, 660, 10, "1887.60"],
    ] as const;
    const payroll = await examinePdf(fixture(lines), "payroll");
    expect(payroll.anomalies.map((a) => [a.kind, a.level])).toEqual([["payroll-sum", "inconsistent"]]);
    expect((await examinePdf(fixture(lines))).anomalies).toEqual([]);
  });
});
