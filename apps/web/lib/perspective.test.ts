import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "./limits";

const state = vi.hoisted(() => ({
  session: null as null | { account: { id: string; email: string; perspective?: string | null; territory?: string } },
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

import { firstCheck, wordingOf } from "./perspective-defaults";

const call = async (method: "GET" | "PUT", body?: unknown, field: "perspective" | "territory" = "perspective") => {
  const { GET, PUT } =
    field === "perspective"
      ? await import("../app/api/me/perspective/route")
      : await import("../app/api/me/territory/route");
  const req = new Request(`https://dev.verikora.com/api/me/${field}`, {
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

describe("PUT /api/me/perspective — the side of the lease, chosen at onboarding and changeable in settings", () => {
  it("answers 401 to a signed-out caller", async () => {
    expect((await call("GET")).status).toBe(401);
    expect((await call("PUT", { perspective: "tenant" })).status).toBe(401);
  });

  it("keeps the side of a signed-in person and writes it to the audit log", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", perspective: null } };
    const res = await call("PUT", { perspective: "landlord" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ perspective: "landlord" });
    expect(state.saved).toEqual([["acc-1", "landlord"]]);
    expect(state.audits[0]).toMatchObject({
      action: "profile.perspective_set",
      actorId: "acc-1",
      detail: { from: null, to: "landlord" },
    });
  });

  it("refuses any other value with 400", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", perspective: null } };
    expect((await call("PUT", { perspective: "admin" })).status).toBe(400);
    expect((await call("PUT", {})).status).toBe(400);
    expect(state.saved).toEqual([]);
  });

  it("accepts every audience of « Pour qui ? »", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", perspective: null } };
    for (const a of ["tenant", "landlord", "freelancer", "business"])
      expect((await call("PUT", { perspective: a })).status).toBe(200);
  });

  it("reads the side back", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", perspective: "tenant" } };
    expect(await (await call("GET")).json()).toEqual({ perspective: "tenant" });
  });
});

describe("PUT /api/me/territory — the territory whose checks the check page lists (krizaka-internal#2292)", () => {
  it("answers 401 to a signed-out caller", async () => {
    expect((await call("GET", undefined, "territory")).status).toBe(401);
    expect((await call("PUT", { territory: "FR" }, "territory")).status).toBe(401);
  });

  it("keeps the territory and writes it to the audit log", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "QC" } };
    const res = await call("PUT", { territory: "FR" }, "territory");
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
      expect((await call("PUT", { territory: t }, "territory")).status).toBe(200);
    }
  });

  it("refuses any other value with 400, and writes nothing", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "QC" } };
    expect((await call("PUT", { territory: "DE" }, "territory")).status).toBe(400);
    expect((await call("PUT", { territory: "qc" }, "territory")).status).toBe(400);
    expect((await call("PUT", {}, "territory")).status).toBe(400);
    expect(state.saved).toEqual([]);
  });

  it("reads the territory back", async () => {
    state.session = { account: { id: "acc-1", email: "a@x.test", territory: "FR" } };
    expect(await (await call("GET", undefined, "territory")).json()).toEqual({ territory: "FR" });
  });
});

describe("the side drives the defaults, not the rules", () => {
  it("starts with the compliance check, except for a landlord's « other » documents (the tenant's papers)", () => {
    expect(firstCheck("tenant", "lease")).toBe("compliance-check");
    expect(firstCheck("tenant", "other")).toBe("compliance-check");
    expect(firstCheck("landlord", "lease")).toBe("compliance-check");
    expect(firstCheck("landlord", "other")).toBe("document-authenticity");
    expect(firstCheck(null, "other")).toBe("compliance-check");
  });

  it("offers a freelancer or a business the file's examination first: no compliance rules exist for them yet", () => {
    for (const a of ["freelancer", "business"] as const)
      for (const kind of ["lease", "contract", "invoice", "other"] as const)
        expect(firstCheck(a, kind)).toBe("document-authenticity");
  });

  it("reads the neutral wording until a side is chosen", () => {
    expect(wordingOf(null)).toBe("neutral");
    expect(wordingOf("tenant")).toBe("tenant");
  });
});
