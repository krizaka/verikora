import { describe, expect, it } from "vitest";

import { zipEntries, zipEntryBytes } from "../preflight/inspector";
import { exportBatchZip, type ExportDeps, safeName } from "./export";
import type { BatchItemView, BatchView } from "./run";

const item = (line: number, patch: Partial<BatchItemView> = {}): BatchItemView => ({
  id: `i${line}`,
  line,
  file: `bail-${line}.pdf`,
  reference: `LAURIER-${line}`,
  state: "done",
  error: null,
  documentId: `d${line}`,
  analysisId: `a${line}`,
  ...patch,
});
const batch = (items: BatchItemView[]): BatchView => ({
  id: "b1",
  name: "Immeuble Laurier",
  createdAt: "2026-10-23T10:00:00.000Z",
  finishedAt: "2026-10-23T10:05:00.000Z",
  items,
  counts: { pending: 0, reused: 0, running: 0, done: 0, failed: 0, refused: 0 },
  pausedBy: null,
});
const REPORT = { findings: [] } as never;
const deps = (patch: Partial<ExportDeps> = {}): ExportDeps => ({
  readme: "Verikora — informative checks, not legal advice.\n",
  maxBytes: 1 << 20,
  analysis: async (i) => ({
    studio: i.line === 4 ? "document-authenticity" : "compliance-check",
    runId: `run-${i.line}`,
    blueprintVersion: "1.0.0",
    report: i.line === 6 ? null : REPORT,
  }),
  pdf: async (i) => (i.line === 5 ? { code: "TRANSLATION_PENDING" } : { bytes: Buffer.from(`%PDF signed ${i.line}`) }),
  ...patch,
});

describe("the reports of a batch in one archive (verikora#242)", () => {
  it("holds the CSV, the README, the signed PDF of each compliance row and the signals of each authenticity row", async () => {
    const out = await exportBatchZip(
      batch([item(2), item(3, { reference: "Étienne / bail #3" }), item(4, { file: "talon.pdf", reference: null })]),
      "fr",
      deps(),
    );
    expect(out.files).toEqual([
      "lot.csv",
      "LISEZ-MOI.txt",
      "rapports/2-LAURIER-2-fr.pdf",
      "rapports/3-Etienne-bail-3-fr.pdf",
      "signaux/4-talon.json",
    ]);
    expect(zipEntryBytes(out.bytes, "rapports/2-LAURIER-2-fr.pdf", 1 << 20)!.toString()).toBe("%PDF signed 2");
    const signals = JSON.parse(zipEntryBytes(out.bytes, "signaux/4-talon.json", 1 << 20)!.toString());
    expect(signals).toMatchObject({ file: "talon.pdf", sovkora: { runId: "run-4", studioVersion: "1.0.0" } });
    expect(zipEntryBytes(out.bytes, "LISEZ-MOI.txt", 1 << 20)!.toString()).toContain("not legal advice");
    expect(zipEntries(out.bytes)).toHaveLength(5);
  });

  it("lists every row in lot.csv — and a row without a report says why, never silently missing", async () => {
    const out = await exportBatchZip(
      batch([
        item(2),
        item(3, { state: "refused", error: "FILE_NOT_SENT", documentId: null, analysisId: null }),
        item(4, { state: "failed", error: "FAILED" }),
        item(5),
        item(6),
        item(7, { state: "pending", error: "SOVKORA_BUSY" }),
      ]),
      "en",
      deps(),
    );
    const csv = zipEntryBytes(out.bytes, "lot.csv", 1 << 20)!
      .toString()
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(csv[0]).toBe("line,file,reference,state,reason,report_file");
    expect(csv.slice(1)).toEqual([
      "2,bail-2.pdf,LAURIER-2,done,,rapports/2-LAURIER-2-en.pdf",
      "3,bail-3.pdf,LAURIER-3,refused,FILE_NOT_SENT,",
      "4,bail-4.pdf,LAURIER-4,failed,FAILED,",
      "5,bail-5.pdf,LAURIER-5,done,TRANSLATION_PENDING,",
      "6,bail-6.pdf,LAURIER-6,done,REPORT_NOT_READY,",
      "7,bail-7.pdf,LAURIER-7,pending,SOVKORA_BUSY,",
    ]);
    expect(out.rows.filter((r) => r.file).map((r) => r.line)).toEqual([2]);
  });

  it("names the PDF in the language asked, one row a file even when two rows share a reference", async () => {
    const out = await exportBatchZip(batch([item(2, { reference: "X" }), item(3, { reference: "X" })]), "en", deps());
    expect(out.files.filter((f) => f.startsWith("rapports/"))).toEqual(["rapports/2-X-en.pdf", "rapports/3-X-en.pdf"]);
  });

  it("refuses an archive past the limit with a 413, instead of cutting rows", async () => {
    await expect(exportBatchZip(batch([item(2)]), "fr", deps({ maxBytes: 50 }))).rejects.toMatchObject({
      status: 413,
      body: { code: "EXPORT_TOO_LARGE" },
    });
  });

  it("stops rendering reports the moment the budget is exceeded — later reports are not even requested", async () => {
    const requested: number[] = [];
    const pdf: ExportDeps["pdf"] = async (i) => {
      requested.push(i.line);
      return { bytes: Buffer.alloc(40) };
    };
    await expect(
      exportBatchZip(
        batch([item(2), item(3), item(4), item(5), item(6)]),
        "fr",
        deps({
          pdf,
          maxBytes: 100,
          analysis: async () => ({ studio: "compliance-check", runId: "r", blueprintVersion: "1", report: REPORT }),
        }),
      ),
    ).rejects.toMatchObject({ status: 413, body: { code: "EXPORT_TOO_LARGE" } });
    expect(requested).toEqual([2, 3, 4]);
  });

  it("neutralises a formula in a file name or a reference, in lot.csv", async () => {
    const out = await exportBatchZip(batch([item(2, { file: "=cmd.pdf", reference: "@SUM(1)" })]), "fr", deps());
    const csv = zipEntryBytes(out.bytes, "lot.csv", 1 << 20)!.toString();
    expect(csv).toContain("2,'=cmd.pdf,'@SUM(1),done,,");
    expect(csv).not.toMatch(/,=cmd|,@SUM/);
  });

  it("is deterministic", async () => {
    const a = await exportBatchZip(batch([item(2)]), "fr", deps());
    const b = await exportBatchZip(batch([item(2)]), "fr", deps());
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });
});

describe("file names", () => {
  it("folds accents, drops separators and anything that could escape a folder", () => {
    expect(safeName("Étienne / Léa #3")).toBe("Etienne-Lea-3");
    expect(safeName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeName("  ")).toBe("document");
    expect(safeName("x".repeat(200))).toHaveLength(60);
  });
});
