import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { id: string; account: Record<string, unknown> },
  calls: [] as unknown[][],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () => state.session,
}));
vi.mock("./settings/guards", () => ({ assertOpen: async () => undefined }));
vi.mock("./settings/instance", () => ({ appSettings: () => ({ get: async () => undefined }) }));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));
vi.mock("./owner-report-shares", () => ({
  createShare: async (...a: unknown[]) => (
    state.calls.push(["create", ...a]),
    { id: "s1", token: "tok", expiresAt: "2026-11-03T00:00:00.000Z" }
  ),
  listShares: async (...a: unknown[]) => (
    state.calls.push(["list", ...a]),
    [{ id: "s1", recipient: "", state: "live", createdAt: "x", expiresAt: "y", views: 2 }]
  ),
  emailShare: async (...a: unknown[]) => (state.calls.push(["email", ...a]), { sentTo: "o@exemple.test" }),
  revokeShare: async (...a: unknown[]) => void state.calls.push(["revoke", ...a]),
}));

import { DELETE, GET, POST } from "../app/api/applications/[id]/report-shares/route";
import { POST as SEND } from "../app/api/applications/[id]/report-shares/send/route";
import { resetRateLimits } from "./limits";

const FILE = "22222222-2222-4222-8222-222222222222";
const ERIC = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "eric@verikora.test",
  role: "USER",
  locale: "fr",
  perspective: "landlord",
};
const ctx = { params: Promise.resolve({ id: FILE }) };
const req = (method: string, body?: unknown) =>
  new Request(`https://dev.verikora.com/api/applications/${FILE}/report-shares`, {
    method,
    headers: { "x-forwarded-for": "203.0.113.9", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  resetRateLimits();
  state.session = { id: "s", account: ERIC };
  state.calls = [];
});

describe("the owner links of a file (verikora#128)", () => {
  it("creates a link with the chosen days: 201, the token once, never cached", async () => {
    const res = await POST(req("POST", { days: 30 }), ctx);
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ id: "s1", token: "tok" });
    expect(state.calls[0]?.slice(0, 4)).toMatchObject(["create", { id: ERIC.id }, FILE, { days: 30 }]);
  });

  it("lists the links of the file with their views", async () => {
    const res = await GET(req("GET"), ctx);
    expect((await res.json()).shares[0]).toMatchObject({ id: "s1", state: "live", views: 2 });
    expect(state.calls[0]?.slice(0, 3)).toEqual(["list", ERIC.id, FILE]);
  });

  it("revokes one link of the file", async () => {
    const res = await DELETE(req("DELETE", { shareId: "s1" }), ctx);
    expect(await res.json()).toEqual({ revoked: true });
    expect(state.calls[0]?.slice(0, 4)).toMatchObject(["revoke", { id: ERIC.id }, FILE, "s1"]);
  });

  it("signed out, none of the three answers", async () => {
    state.session = null;
    for (const res of [
      await GET(req("GET"), ctx),
      await POST(req("POST", {}), ctx),
      await DELETE(req("DELETE", { shareId: "s1" }), ctx),
    ])
      expect(res.status).toBe(401);
    expect(state.calls).toEqual([]);
  });
});

describe("e-mailing the owner link (verikora#130)", () => {
  const send = (body: unknown) => SEND(req("POST", body), ctx);
  const body = { token: "sc1.tok", email: "o@exemple.test", locale: "fr" };

  it("sends for the signed-in manager: 202, never cached, the manager's note passed on", async () => {
    const res = await send({ ...body, message: "Bonjour" });
    expect(res.status).toBe(202);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.calls[0]?.slice(0, 4)).toMatchObject([
      "email",
      { id: ERIC.id },
      FILE,
      { token: "sc1.tok", locale: "fr", message: "Bonjour" },
    ]);
  });

  it("needs a session and a language", async () => {
    expect((await send({ ...body, locale: "de" })).status).toBe(400);
    state.session = null;
    expect((await send(body)).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("answers 429 past the limit, with the time to wait", async () => {
    for (let i = 0; i < 10; i++) expect((await send(body)).status).toBe(202);
    const res = await send(body);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(state.calls).toHaveLength(10);
  });
});
