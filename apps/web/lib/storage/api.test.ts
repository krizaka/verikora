import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "../limits";

const state = vi.hoisted(() => ({
  session: null as null | {
    id: string;
    account: { id: string; email: string; perspective: null; role: "USER"; locale: "fr"; name: null; avatarSeed: null };
  },
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("../session", async (orig) => ({
  ...(await orig<typeof import("../session")>()),
  resolveSession: async () => state.session,
}));
vi.mock("../audit", () => ({ audit: async () => undefined }));
vi.mock("../db", () => ({ query: async () => [] }));

const json = (method: string, body?: unknown) =>
  new Request("https://dev.verikora.com/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.12", "content-type": "application/json" },
  });
const s3 = {
  endpoint: "https://169.254.169.254",
  region: "ca-central-1",
  bucket: "docs",
  accessKeyId: "id",
  secretAccessKey: "key",
};

beforeEach(() => {
  resetRateLimits();
  state.session = {
    id: "s1",
    account: {
      id: "22222222-2222-4222-8222-222222222222",
      email: "eric@verikora.test",
      perspective: null,
      role: "USER",
      locale: "fr",
      name: null,
      avatarSeed: null,
    },
  };
});

describe("the storage routes", () => {
  it("refuse a signed-out caller", async () => {
    state.session = null;
    const { GET } = await import("../../app/api/me/storage/route");
    expect((await GET(json("GET"))).status).toBe(401);
  });

  it("the connection test never connects to an address on Krizaka's own network", async () => {
    const { POST } = await import("../../app/api/me/storage/test/route");
    const res = await POST(json("POST", s3));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verification: { ok: false, error: "ENDPOINT_NOT_ALLOWED", steps: [] } });
  });

  it("saving an own S3 is refused when the endpoint is not allowed, before anything is stored", async () => {
    const { PUT } = await import("../../app/api/me/storage/route");
    const res = await PUT(json("PUT", { mode: "s3", keepDefault: false, s3 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
  });

  it("keeping by default makes no sense when keeping is off", async () => {
    const { PUT } = await import("../../app/api/me/storage/route");
    expect((await PUT(json("PUT", { mode: "none", keepDefault: true }))).status).toBe(400);
  });
});
