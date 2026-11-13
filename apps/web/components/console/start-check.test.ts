import { describe, expect, it, vi } from "vitest";

import { storedDocument } from "@/lib/fixtures/stored-document";

import { startIfSure } from "./start-check";

const detail = (confidence: "high" | "low", documentType: "lease" | "invoice" | null) =>
  storedDocument({
    insight: {
      understanding: {
        nature: documentType ? { id: documentType, label: { fr: "", en: "" }, confidence, score: 0.9 } : null,
        check: documentType ? { studio: "compliance-check", documentType, ruleset: null } : null,
      },
    },
  });

const NOON = new Date("2026-10-23T12:00:00Z");

describe("starting the check once a file landed", () => {
  it("starts it when the kind is sure, and says so", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(detail("high", "invoice")).mockResolvedValueOnce({ analysis: {} });
    expect(await startIfSure("d1", "auto", ["QC"], NOON, fetcher as never)).toEqual({ started: true, refused: null });
    expect(fetcher.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      json: { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" },
    });
  });
  it("starts nothing when the kind is uncertain (the report tab asks), or when the detail cannot be read", async () => {
    expect(
      await startIfSure("d1", "auto", ["QC"], NOON, vi.fn().mockResolvedValueOnce(detail("low", "lease")) as never),
    ).toEqual({ started: false, refused: null });
    expect(
      await startIfSure("d1", "auto", ["QC"], NOON, vi.fn().mockRejectedValueOnce(new Error("offline")) as never),
    ).toEqual({ started: false, refused: null });
  });
  it("keeps the engine's refusal for the report tab", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(detail("high", "lease"))
      .mockRejectedValueOnce(Object.assign(new Error("paywall"), { body: { code: "PAYWALL" } }));
    expect(await startIfSure("d1", "lease", ["QC"], NOON, fetcher as never)).toEqual({
      started: false,
      refused: "PAYWALL",
    });
  });
});

describe("the text is read after the upload answered (202 Accepted)", () => {
  const reading = (extraction: "queued" | "running" | "done" | "failed", extractionError?: string) => {
    const d = detail("high", "invoice");
    return { document: { ...d.document, extraction, ...(extractionError ? { extractionError } : {}) } };
  };
  it("waits for the reading to end, then starts the check", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reading("running"))
      .mockResolvedValueOnce(reading("done"))
      .mockResolvedValueOnce({ analysis: {} });
    vi.useFakeTimers();
    const outcome = startIfSure("d1", "auto", ["QC"], NOON, fetcher as never);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await outcome).toEqual({ started: true, refused: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("keeps the reason when the text could not be read, and starts nothing", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reading("failed", "FILE_TOO_COMPLEX"));
    expect(await startIfSure("d1", "auto", ["QC"], NOON, fetcher as never)).toEqual({
      started: false,
      refused: "FILE_TOO_COMPLEX",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("the check is dated on the Québec day, never the UTC day", () => {
  const startedWith = async (instant: string) => {
    const fetcher = vi.fn().mockResolvedValueOnce(detail("high", "invoice")).mockResolvedValueOnce({ analysis: {} });
    await startIfSure("d1", "auto", ["QC"], new Date(instant), fetcher as never);
    return fetcher.mock.calls[1]![1];
  };
  it("dates a check started on the Québec evening (UTC is already the next day) on the day in Montréal", async () => {
    expect(await startedWith("2026-10-24T01:30:00Z")).toMatchObject({ json: { asOf: "2026-10-23" } });
  });
  it("dates a check started at noon on that day", async () => {
    expect(await startedWith("2026-10-24T12:00:00Z")).toMatchObject({ json: { asOf: "2026-10-24" } });
  });
});
