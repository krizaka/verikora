import { describe, expect, it } from "vitest";

import { analysePayStub, parseAmount } from "./payroll-maths";
import type { TextRun } from "./forensics-text";

const run = (text: string, x: number, y: number, page = 1): TextRun => ({
  page,
  text,
  font: "Arial",
  size: 10,
  x,
  y,
  width: text.length * 5,
  height: 10,
});
/** One printed row: the label at the left, then the amounts left to right (the period, then the year to date). */
const row = (label: string, y: number, ...amounts: string[]): TextRun[] => [
  run(label, 72, y),
  ...amounts.map((a, i) => run(a, 300 + i * 100, y)),
];
const stub = (gross: string, deductions: string, net: string, grossYtd = "9 600,00"): TextRun[] => [
  ...row("Salaire brut", 700, gross, grossYtd),
  ...row("Total des retenues", 680, deductions),
  ...row("Salaire net", 660, net),
];

describe("parseAmount", () => {
  it.each([
    ["2 400,00", 240000],
    ["2,400.00", 240000],
    ["1887.60", 188760],
    ["1 887,60 $", 188760],
    ["-512.40", -51240],
    ["0,05", 5],
  ])("reads %s", (text, cents) => expect(parseAmount(text)).toBe(cents));
  it.each(["Gross", "2024-11-05", "12", "1,234", ""])("does not guess %s", (text) =>
    expect(parseAmount(text)).toBeNull(),
  );
});

describe("analysePayStub (CONTENT-PAY-001, CONTENT-PAY-002)", () => {
  it("finds nothing on a stub whose figures add up", () => {
    expect(analysePayStub(stub("2 400,00", "512,40", "1 887,60"))).toEqual([]);
  });

  it("flags an altered gross with an unchanged net, as inconsistent, with the boxes of the figures", () => {
    const found = analysePayStub(stub("3 400,00", "512,40", "1 887,60"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "payroll-sum", level: "inconsistent", page: 1 });
    expect(found[0]?.bbox).toMatchObject({ x: 300 });
    expect(found[0]?.evidence).toContain("CONTENT-PAY-001");
  });

  it("accepts the stub's own rounding of one cent", () => {
    expect(analysePayStub(stub("2 400,00", "512,40", "1 887,61"))).toEqual([]);
  });

  it("flags a year-to-date total smaller than the period it should contain", () => {
    const found = analysePayStub(stub("2 400,00", "512,40", "1 887,60", "1 200,00"));
    expect(found.map((a) => a.kind)).toEqual(["payroll-ytd"]);
    expect(found[0]?.level).toBe("inconsistent");
  });

  it("does not run a case whose field is missing, and never guesses", () => {
    const noNet = [...row("Salaire brut", 700, "2 400,00"), ...row("Total des retenues", 680, "512,40")];
    expect(analysePayStub(noNet)).toEqual([]);
  });

  it("does not run when a label is printed twice (ambiguous)", () => {
    expect(analysePayStub([...stub("3 400,00", "512,40", "1 887,60"), ...row("Salaire net", 600, "99,00")])).toEqual(
      [],
    );
  });

  it("reads English labels", () => {
    const runs = [
      ...row("Gross pay", 700, "2,400.00"),
      ...row("Total deductions", 680, "512.40"),
      ...row("Net pay", 660, "1,000.00"),
    ];
    expect(analysePayStub(runs)).toHaveLength(1);
  });
});
