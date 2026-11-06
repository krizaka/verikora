import { readBatchManifest } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { type ApiPort, createVerikoraApi } from "./api";

const BATCH = {
  id: "b1",
  name: "Baux",
  createdAt: "2026-10-23T09:00:00.000Z",
  finishedAt: null,
  items: [
    {
      id: "i1",
      line: 2,
      file: "bail.pdf",
      reference: null,
      state: "running",
      error: null,
      documentId: "d1",
      analysisId: "a1",
    },
  ],
  counts: { pending: 0, reused: 0, running: 1, done: 0, failed: 0, refused: 0 },
  pausedBy: null,
};

function fakePort(answer: unknown) {
  const calls: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const port: ApiPort = {
    async call<T>(path: string, init?: { method?: string; body?: unknown }) {
      calls.push(init ? { path, init } : { path });
      return answer as T;
    },
    url: (path) => `https://dev.verikora.com${path}`,
    authHeaders: async () => ({}),
  };
  return { port, calls };
}

const session = { saveToken: async () => undefined, clearToken: async () => undefined };

describe("batches from the apps (verikora#154, #232)", () => {
  it("sends one manifest row per file with the same check, and the files under the names the rows give", async () => {
    const { port, calls } = fakePort({ batch: BATCH });
    const api = createVerikoraApi(port, session);
    const created = await api.createBatch(
      "Baux",
      [
        { name: "bail.pdf", blob: new Blob(["%PDF"], { type: "application/pdf" }) },
        { name: "bail, annexe.pdf", blob: new Blob(["%PDF"], { type: "application/pdf" }) },
      ],
      "compliance",
    );
    expect(created.items[0]?.state).toBe("running");
    const [call] = calls;
    expect(call?.path).toBe("/api/batches");
    expect(call?.init?.method).toBe("POST");
    const form = call?.init?.body as FormData;
    expect(form.get("name")).toBe("Baux");
    const manifest = readBatchManifest(String(form.get("manifest")));
    expect(manifest.rows.map((r) => [r.file, r.request?.studio, r.errors])).toEqual([
      ["bail.pdf", "compliance-check", []],
      ["bail, annexe.pdf", "compliance-check", []],
    ]);
    expect(form.getAll("files").map((f) => (f as File).name)).toEqual(["bail.pdf", "bail, annexe.pdf"]);
  });

  it("reads a batch and the list, and refuses a state the server never promised", async () => {
    expect((await createVerikoraApi(fakePort({ batch: BATCH }).port, session).fetchBatch("b1")).counts.running).toBe(1);
    const list = await createVerikoraApi(
      fakePort({
        batches: [{ id: "b1", name: "Baux", createdAt: BATCH.createdAt, finishedAt: null, items: 1, done: 0 }],
      }).port,
      session,
    ).listBatches();
    expect(list).toHaveLength(1);
    const odd = { batch: { ...BATCH, items: [{ ...BATCH.items[0], state: "exploded" }] } };
    await expect(createVerikoraApi(fakePort(odd).port, session).fetchBatch("b1")).rejects.toThrow();
  });

  it("reads who is signed in for the account menu", async () => {
    const { port, calls } = fakePort({ account: { email: "eric@example.com", name: "Éric", avatarSeed: null } });
    expect(await createVerikoraApi(port, session).fetchMe()).toEqual({
      email: "eric@example.com",
      name: "Éric",
      avatarSeed: null,
    });
    expect(calls).toEqual([{ path: "/api/me" }]);
  });
});
