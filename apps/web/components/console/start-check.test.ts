import { describe, expect, it, vi } from "vitest";

import { startIfSure } from "./start-check";

const detail = (confidence: "high" | "low", documentType: "lease" | "invoice" | null) => ({
  document: { id: "d1", title: "t", filename: "t.pdf", mimeType: "application/pdf", kind: "lease", sizeBytes: 1, pages: 1, hasText: true, status: "stored", createdAt: "2026-10-23T00:00:00.000Z", sha256: "a".repeat(64), text: "", analyses: [], storage: { kind: "database", endpoint: null, region: "ca", residency: "canada", encrypted: true, owner: "krizaka", devOnly: false }, retainUntil: null, purged: false, insight: { understanding: { nature: documentType ? { id: documentType, label: { fr: "", en: "" }, confidence, score: 0.9 } : null, check: documentType ? { studio: "compliance-check", documentType, ruleset: null } : null } } },
});

describe("starting the check once a file landed", () => {
  it("starts it when the kind is sure, and says so", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(detail("high", "invoice")).mockResolvedValueOnce({ analysis: {} });
    expect(await startIfSure("d1", "auto", ["QC"], fetcher as never)).toEqual({ started: true, refused: null });
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "POST", json: { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" } });
  });
  it("starts nothing when the kind is uncertain (the report tab asks), or when the detail cannot be read", async () => {
    expect(await startIfSure("d1", "auto", ["QC"], vi.fn().mockResolvedValueOnce(detail("low", "lease")) as never)).toEqual({ started: false, refused: null });
    expect(await startIfSure("d1", "auto", ["QC"], vi.fn().mockRejectedValueOnce(new Error("offline")) as never)).toEqual({ started: false, refused: null });
  });
  it("keeps the engine's refusal for the report tab", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(detail("high", "lease")).mockRejectedValueOnce(Object.assign(new Error("paywall"), { body: { code: "PAYWALL" } }));
    expect(await startIfSure("d1", "lease", ["QC"], fetcher as never)).toEqual({ started: false, refused: "PAYWALL" });
  });
});
