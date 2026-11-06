import { describe, expect, it } from "vitest";

import type { BatchItemView, BatchView } from "../batch/run";
import { checkView } from "./checks";

const item = (patch: Partial<BatchItemView> = {}): BatchItemView => ({
  id: "i",
  line: 2,
  file: "bail.pdf",
  reference: "R-1",
  state: "running",
  error: null,
  documentId: "d",
  analysisId: "a",
  ...patch,
});
const batch = (items: BatchItemView[], patch: Partial<BatchView> = {}): BatchView => ({
  id: "b1",
  name: "R-1",
  createdAt: "2026-10-23T10:00:00.000Z",
  finishedAt: null,
  items,
  counts: { pending: 0, reused: 0, running: 0, done: 0, failed: 0, refused: 0 },
  pausedBy: null,
  ...patch,
});
const REPORT = { findings: [] } as never;

describe("checkView (verikora#202)", () => {
  it("is the one row of its batch, under the batch's id", () => {
    expect(checkView(batch([item()]))).toEqual({
      id: "b1",
      state: "running",
      file: "bail.pdf",
      reference: "R-1",
      error: null,
      documentId: "d",
      analysisId: "a",
      report: null,
      createdAt: "2026-10-23T10:00:00.000Z",
      finishedAt: null,
    });
  });

  it("carries the report only once the check is done or reused, never while it runs or after it failed", () => {
    expect(checkView(batch([item({ state: "done" })]), REPORT).report).toBe(REPORT);
    expect(checkView(batch([item({ state: "reused" })]), REPORT).report).toBe(REPORT);
    expect(checkView(batch([item({ state: "running" })]), REPORT).report).toBeNull();
    expect(checkView(batch([item({ state: "failed", error: "FAILED" })]), REPORT).report).toBeNull();
  });

  it("says why it did not run: the row's code, or the reason the batch waits", () => {
    expect(
      checkView(batch([item({ state: "refused", error: "UNKNOWN_CHECK", documentId: null, analysisId: null })])).error,
    ).toBe("UNKNOWN_CHECK");
    expect(checkView(batch([item({ state: "pending", analysisId: null })], { pausedBy: "PAYWALL" })).error).toBe(
      "PAYWALL",
    );
    expect(checkView(batch([item({ state: "running" })], { pausedBy: "PAYWALL" })).error).toBeNull();
  });

  it("refuses a batch without a row: it is not a check", () => {
    expect(() => checkView(batch([]))).toThrow(/no row/);
  });
});
