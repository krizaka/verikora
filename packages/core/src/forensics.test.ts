import { describe, expect, it } from "vitest";

import { analysePdf, countRevisions, fraudReport, NotAPdfError } from "./forensics";

/**
 * Synthetic fixtures built byte by byte (persona cast data, no real document). The clean stub is what a payroll system prints;
 * the edited one is the same file re-saved by a consumer editor, which appends an incremental update with its own Info.
 */
const bytesOf = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
const objects = (producer: string, id = 4) =>
  `${id} 0 obj\n<< /Producer (${producer}) /Creator (${producer}) >>\nendobj\n`;
const base = (producer: string) =>
  `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n${objects(producer)}xref\n0 5\ntrailer\n<< /Size 5 /Root 1 0 R /Info 4 0 R >>\nstartxref\n300\n%%EOF\n`;
const cleanStub = (producer = "ADP Payroll Services") => bytesOf(base(producer));
const edited = (producer: string, by: string) =>
  bytesOf(
    `${base(producer)}${objects(by, 5)}xref\n5 1\ntrailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R /Prev 300 >>\nstartxref\n700\n%%EOF\n`,
  );

describe("analysePdf", () => {
  it("finds nothing on a clean payroll stub, and never gives a score", () => {
    const report = analysePdf(cleanStub(), { documentKind: "payroll" });
    expect(report).not.toHaveProperty("tamperScore");
    expect(report.anomalies).toEqual([]);
    expect(report.revisions).toBe(1);
    expect(fraudReport.parse(report)).toEqual(report);
  });

  it("reports the same stub edited in a consumer editor as three unusual signals, none inconsistent", () => {
    const report = analysePdf(edited("ADP Payroll Services", "iLovePDF"), { documentKind: "payroll" });
    expect(report.anomalies.map((a) => a.level)).toEqual(["unusual", "unusual", "unusual"]);
    expect(report.anomalies.map((a) => a.kind).sort()).toEqual([
      "incremental-update",
      "producer-changed",
      "producer-mismatch",
    ]);
    expect(report.revisions).toBe(2);
    expect(report.producer).toBe("iLovePDF");
    expect(fraudReport.parse(report)).toEqual(report);
  });

  it("flags producer-mismatch for a consumer editor on a payroll document", () => {
    const report = analysePdf(cleanStub("Canva"), { documentKind: "payroll" });
    expect(report.anomalies).toHaveLength(1);
    expect(report.anomalies[0]).toMatchObject({ kind: "producer-mismatch", page: null, bbox: null });
    expect(report.anomalies[0]?.evidence).toContain("Canva");
  });

  it("does not judge a producer against a document that has no expected origin", () => {
    expect(analysePdf(cleanStub("Canva")).anomalies).toEqual([]);
    expect(analysePdf(cleanStub("Canva"), { documentKind: "other" }).anomalies).toEqual([]);
  });

  it("reads a hex-encoded UTF-16 producer", () => {
    const hex = Array.from("\uFEFFSejda", (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
    const bytes = bytesOf(base("x").replace("(x) /Creator (x)", `<${hex}> /Creator (x)`));
    expect(analysePdf(bytes, { documentKind: "payroll" }).producer).toBe("Sejda");
  });

  it("reads a signed file's update as observed, an unsigned one as unusual", () => {
    const unsigned = analysePdf(edited("ADP", "ADP"));
    const signed = analysePdf(
      bytesOf(
        new TextDecoder("latin1")
          .decode(edited("ADP", "ADP"))
          .replace("/Type /Page ", "/ByteRange [0 10 20 30] /Type /Page "),
      ),
    );
    expect(unsigned.anomalies[0]?.level).toBe("unusual");
    expect(signed.anomalies[0]?.level).toBe("observed");
    expect(signed.anomalies[0]?.evidence).toContain("signature");
  });

  it("does not count the second %%EOF of a linearized file as a change", () => {
    const text = base("ADP").replace("1 0 obj", "1 0 obj\n<< /Linearized 1 >>\nendobj\n9 0 obj") + "%%EOF\n";
    expect(countRevisions(text)).toBe(1);
    expect(analysePdf(bytesOf(text)).anomalies).toEqual([]);
  });

  it("refuses what is not a PDF", () => {
    expect(() => analysePdf(bytesOf("hello"))).toThrow(NotAPdfError);
  });
});
