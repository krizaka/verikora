import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "../limits";

const state = vi.hoisted(() => ({
  session: null as null | { account: { id: string; email: string; perspective: string | null } },
  calls: [] as string[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("../session", async (orig) => ({
  ...(await orig<typeof import("../session")>()),
  resolveSession: async () => state.session,
}));
vi.mock("../audit", () => ({ audit: async () => undefined }));
vi.mock("../db", () => ({
  query: async (text: string) => {
    state.calls.push(text);
    return [];
  },
}));

const json = (method: string, body?: unknown) =>
  new Request("https://dev.verikora.com/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.9", "content-type": "application/json" },
  });
const ctx = (id = "11111111-1111-4111-8111-111111111111") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  resetRateLimits();
  state.calls = [];
  state.session = {
    account: { id: "22222222-2222-4222-8222-222222222222", email: "eric@verikora.test", perspective: "tenant" },
  };
});

describe("the organisation routes", () => {
  it("refuse a signed-out caller", async () => {
    state.session = null;
    const { POST } = await import("../../app/api/collections/route");
    expect((await POST(json("POST", { libraryId: "x", name: "Baux" }))).status).toBe(401);
  });

  it("the apps read the libraries and a collection, signed in only", async () => {
    const libraries = await import("../../app/api/libraries/route");
    const collection = await import("../../app/api/collections/[id]/route");
    const ok = await libraries.GET(json("GET"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ libraries: [], tags: [] });
    expect((await collection.GET(json("GET"), ctx())).status).toBe(404);
    state.session = null;
    expect((await libraries.GET(json("GET"))).status).toBe(401);
    expect((await collection.GET(json("GET"), ctx())).status).toBe(401);
  });

  it("a deletion must say what happens to the files", async () => {
    const { DELETE } = await import("../../app/api/collections/[id]/route");
    const res = await DELETE(json("DELETE", {}), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a tag colour is one of the known names", async () => {
    const { POST } = await import("../../app/api/tags/route");
    expect((await POST(json("POST", { name: "Urgent", color: "#ff0000" }))).status).toBe(400);
  });

  it("an id that is not an id is a 404, never a query on it", async () => {
    const { PUT } = await import("../../app/api/documents/[id]/placement/route");
    const res = await PUT(json("PUT", { collectionId: null }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(state.calls.some((c) => c.includes("UPDATE documents"))).toBe(false);
  });
});
