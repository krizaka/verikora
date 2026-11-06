import { ExtractionNotReady } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { type ApiPort, createVerikoraApi } from "./api";

const summary = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  title: "Bail",
  filename: "bail.pdf",
  mimeType: "application/pdf",
  kind: "other",
  sizeBytes: 10,
  pages: null,
  hasText: false,
  status: "stored",
  createdAt: "2026-10-26T12:00:00.000Z",
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({ document: { ...summary(over), analyses: [] } });

function api(answers: Record<string, unknown[]>) {
  const calls: string[] = [];
  const port: ApiPort = {
    async call<T>(path: string) {
      calls.push(path);
      const next = answers[path]!.length > 1 ? answers[path]!.shift() : answers[path]![0];
      return next as T;
    },
    url: (path) => path,
    authHeaders: async () => ({}),
  };
  const session = { saveToken: async () => undefined, clearToken: async () => undefined };
  return { calls, client: createVerikoraApi(port, session, { sleep: async () => undefined }) };
}

describe("uploading a document (202 Accepted)", () => {
  it("resolves at once for a document whose text is already read", async () => {
    const { client, calls } = api({
      "/api/documents": [{ document: summary({ extraction: "done", hasText: true }), duplicate: true }],
    });
    const { document } = await client.uploadDocument(new FormData());
    expect(document.hasText).toBe(true);
    expect(calls).toEqual(["/api/documents"]);
  });

  it("waits for the text to be read, then hands over the document as it now is", async () => {
    const { client, calls } = api({
      "/api/documents": [{ document: summary({ extraction: "queued" }), duplicate: false, status: "QUEUED" }],
      "/api/documents/d1": [
        detail({ extraction: "running" }),
        detail({ extraction: "done", kind: "lease", hasText: true, pages: 3 }),
      ],
    });
    const { document } = await client.uploadDocument(new FormData());
    expect(document).toMatchObject({ extraction: "done", kind: "lease", hasText: true, pages: 3 });
    expect(calls).toEqual(["/api/documents", "/api/documents/d1", "/api/documents/d1"]);
  });

  it("rejects with the reason when the reading failed", async () => {
    const { client } = api({
      "/api/documents": [{ document: summary({ extraction: "queued" }), duplicate: false }],
      "/api/documents/d1": [
        { document: { ...summary({ extraction: "failed" }), analyses: [], extractionError: "FILE_TOO_COMPLEX" } },
      ],
    });
    await expect(client.uploadDocument(new FormData())).rejects.toMatchObject({ reason: "FILE_TOO_COMPLEX" });
    await expect(client.uploadDocument(new FormData())).rejects.toBeInstanceOf(ExtractionNotReady);
  });
});
