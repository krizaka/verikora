import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "./limits";

const state = vi.hoisted(() => ({
  session: null as null | { account: { id: string; email: string; territory: string } },
  saved: [] as unknown[][],
  audits: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () => state.session,
}));
vi.mock("./settings/guards", () => ({ assertOpen: async () => undefined }));
vi.mock("./audit", () => ({ audit: async (entry: Record<string, unknown>) => void state.audits.push(entry) }));
// The limits read their numbers from the settings (verikora#260): here they are the defaults, and not a query of this test's.
vi.mock("./settings/instance", () => ({ appSettings: () => ({ get: async () => undefined }) }));
vi.mock("./db", () => ({ query: async (_sql: string, values: unknown[]) => void state.saved.push(values) }));

const call = async (method: "GET" | "PUT", body?: unknown) => {
  const { GET, PUT } = await import("../app/api/me/territory/route");
  const req = new Request("https://dev.verikora.com/api/me/territory", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  return method === "GET" ? GET(req) : PUT(req);
};

beforeEach(() => {
  resetRateLimits();
  state.session = null;
  state.saved = [];
  state.audits = [];
});

describe("PUT /api/me/territory — the territory whose checks the check page lists (krizaka-internal#2292)", () => {
  it("answers 401 to a signed-out caller", async () => {
    expect((await call("GET")).status).toBe(401);
    expect((await call("PUT", { territory: "FR" })).status).toBe(401);
  });

  it("keeps the territory and writes it to the audit log", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "QC" } };
    const res = await call("PUT", { territory: "FR" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ territory: "FR" });
    expect(state.saved).toEqual([["acc-1", "FR"]]);
    expect(state.audits[0]).toMatchObject({
      action: "profile.territory_set",
      actorId: "acc-1",
      detail: { from: "QC", to: "FR" },
    });
  });

  it("accepts each territory of the closed set", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "QC" } };
    for (const t of ["QC", "FR", "BE-WAL", "ZZ"]) {
      expect((await call("PUT", { territory: t })).status).toBe(200);
    }
  });

  it("refuses any other value with 400, and writes nothing", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "QC" } };
    expect((await call("PUT", { territory: "DE" })).status).toBe(400);
    expect((await call("PUT", { territory: "qc" })).status).toBe(400);
    expect((await call("PUT", {})).status).toBe(400);
    expect(state.saved).toEqual([]);
  });

  it("reads the territory back", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "FR" } };
    expect(await (await call("GET")).json()).toEqual({ territory: "FR" });
  });
});
