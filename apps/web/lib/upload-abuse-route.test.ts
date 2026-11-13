import { MAX_FILE_BYTES } from "@verikora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cleanPdf, pngBytes, windowsExecutable } from "./preflight/fixtures";
import { VERIKORA_RULES } from "./preflight/rules";

/**
 * Upload abuse at the route (krizaka-internal#2385): what the pre-flight refuses is refused with its code BEFORE anything is
 * stored — no row written, no byte put in a store, no audit line — and counted as a refusal. The route and the pre-flight run
 * for real; the database, the store and the session are doubles that record every touch.
 */
const touched = vi.hoisted(() => ({ queries: [] as string[], puts: 0, audits: 0 }));
const ACCOUNT = { id: "11111111-1111-4111-8111-111111111111", email: "eric@verikora.test" };

vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));
vi.mock("./access", () => ({ requireSession: async () => ({ id: "s", account: ACCOUNT }) }));
vi.mock("./limits", () => ({ limit: async () => undefined }));
vi.mock("./audit", () => ({ audit: async () => void touched.audits++ }));
vi.mock("./db", () => ({
  query: async (text: string) => {
    touched.queries.push(text);
    return [];
  },
  transaction: async () => undefined,
}));
vi.mock("./settings/guards", () => ({
  assertFeature: async () => undefined,
  settingsFor: async () => ({ "limits.purgeAfterHours": { value: 24 } }),
}));
vi.mock("./settings/boundary", async () => {
  const { VERIKORA_RULES: rules } = await import("./preflight/rules");
  return { preflightRulesFrom: () => rules };
});
vi.mock("@/app/active-store", () => {
  const store = {
    describe: () => ({ kind: "memory" }),
    put: async () => void touched.puts++,
  };
  return {
    storesOf: async () => ({ settings: { mode: "managed" }, write: store }),
    workingStore: async () => store,
    storeForDocument: async () => store,
  };
});

import { POST } from "../app/api/documents/route";

const upload = (files: { name: string; type: string; bytes: Uint8Array }[]) => {
  const form = new FormData();
  for (const f of files) {
    form.append("file", new File([f.bytes as BlobPart], f.name, { type: f.type }));
  }
  return POST(new Request("https://dev.verikora.test/api/documents", { method: "POST", body: form }));
};
const refusedBeforeStorage = () => {
  // Only the refusal's own counter may have been written: no document row, no byte in a store, no audit line.
  expect(touched.queries.filter((q) => !q.includes("preflight_events"))).toEqual([]);
  expect(touched.puts).toBe(0);
  expect(touched.audits).toBe(0);
};

beforeEach(() => {
  touched.queries = [];
  touched.puts = 0;
  touched.audits = 0;
});

describe("upload abuse is refused at the route, before anything is stored", () => {
  it("refuses a file over 10 MB: 413 FILE_TOO_LARGE", async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(await cleanPdf());
    const res = await upload([{ name: "big.pdf", type: "application/pdf", bytes: big }]);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "FILE_TOO_LARGE", reason: "TOO_LARGE" });
    expect(res.headers.get("X-Error-Code")).toBe("FILE_TOO_LARGE");
    refusedBeforeStorage();
  });

  it("refuses a type that is not allowed (a GIF image): 415", async () => {
    const gif = Uint8Array.from([..."GIF89a"].map((c) => c.charCodeAt(0)).concat(new Array(64).fill(0)));
    const res = await upload([{ name: "x.gif", type: "image/gif", bytes: gif }]);
    expect(res.status).toBe(415);
    expect(["UNSUPPORTED_TYPE", "FILE_TYPE_MISMATCH"]).toContain((await res.json()).code);
    refusedBeforeStorage();
  });

  it("refuses an executable renamed .pdf: 415 FILE_EXECUTABLE", async () => {
    const res = await upload([{ name: "lease.pdf", type: "application/pdf", bytes: windowsExecutable() }]);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "FILE_EXECUTABLE" });
    refusedBeforeStorage();
  });

  it("refuses a .pdf that is not a PDF (text under a PDF name and type, a PNG under a PDF name)", async () => {
    for (const bytes of [new TextEncoder().encode("just words, no pdf here"), pngBytes()]) {
      touched.queries = [];
      const res = await upload([{ name: "lease.pdf", type: "application/pdf", bytes }]);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await res.json()).toHaveProperty("code");
      refusedBeforeStorage();
    }
  });

  it("refuses an empty file: 400 EMPTY_FILE", async () => {
    const res = await upload([{ name: "empty.pdf", type: "application/pdf", bytes: new Uint8Array(0) }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "EMPTY_FILE" });
    refusedBeforeStorage();
  });

  it("refuses a PDF that runs code: 422 FILE_ACTIVE_CONTENT", async () => {
    const { javascriptPdf } = await import("./preflight/fixtures");
    const res = await upload([{ name: "lease.pdf", type: "application/pdf", bytes: await javascriptPdf() }]);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "FILE_ACTIVE_CONTENT" });
    refusedBeforeStorage();
  });

  it("refuses several PDFs in one request: 400 BAD_REQUEST", async () => {
    const pdf = await cleanPdf();
    const res = await upload([
      { name: "a.pdf", type: "application/pdf", bytes: pdf },
      { name: "b.pdf", type: "application/pdf", bytes: pdf },
    ]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    refusedBeforeStorage();
  });

  it("refuses more photos than make one document: 422 TOO_MANY_PHOTOS", async () => {
    const photos = Array.from({ length: 13 }, (_, i) => ({ name: `p${i}.png`, type: "image/png", bytes: pngBytes() }));
    const res = await upload(photos);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "TOO_MANY_PHOTOS" });
    refusedBeforeStorage();
  });

  it("refuses a request with no file: 400 BAD_REQUEST", async () => {
    const res = await POST(
      new Request("https://dev.verikora.test/api/documents", { method: "POST", body: new FormData() }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    refusedBeforeStorage();
  });

  it("counts a pre-flight refusal as rejected with its reason", async () => {
    await upload([{ name: "lease.pdf", type: "application/pdf", bytes: windowsExecutable() }]);
    expect(touched.queries.some((q) => q.includes("preflight_events"))).toBe(true);
  });

  it("the pre-flight limit is the product's 10 MB", () => {
    expect(VERIKORA_RULES.maxBytes).toBe(10 * 1024 * 1024);
  });
});
