import { analyseTextRuns } from "@yomizaka/core";
import { describe, expect, it } from "vitest";

import { readTextRuns } from "./forensics-runs";

/** A one-page PDF: each entry is a line `[font object, x, y, size, text]`, fonts F1 Helvetica and F2 Courier. */
function fixture(lines: ReadonlyArray<readonly [string, number, number, number, string]>): Uint8Array {
  const stream = lines.map(([f, x, y, size, t]) => `BT /${f} ${size} Tf ${x} ${y} Td (${t}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const table = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${out.length}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

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
