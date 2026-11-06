import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { id: string; account: Record<string, unknown> },
  open: true,
  maintenance: false,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () => state.session,
}));
vi.mock("./settings/guards", async () => {
  const { refuse } = await import("./http");
  return {
    assertOpen: async () => {
      if (state.maintenance) throw refuse(503, "MAINTENANCE", "down");
    },
  };
});
vi.mock("./settings/signup", () => ({ signupOpenNow: async () => state.open }));
vi.mock("./settings/instance", () => ({ appSettings: () => ({ get: async () => undefined }) }));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));

import { GET } from "../app/api/me/route";
import { resetRateLimits } from "./limits";

const call = () =>
  GET(new Request("https://dev.verikora.com/api/me", { headers: { "x-forwarded-for": "203.0.113.7" } }));
const ERIC = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "eric@verikora.test",
  name: "Éric",
  avatarSeed: "plain-2",
  role: "USER",
  locale: "fr",
  perspective: null,
};

beforeEach(() => {
  resetRateLimits();
  state.session = null;
  state.open = true;
  state.maintenance = false;
});

describe("GET /api/me — the family's contract (krizaka-ui#551)", () => {
  it("signed out is a 200, not an error: { signedIn: false, signupOpen }, never cached", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: false, signupOpen: true });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("signed in: the identity the bar shows — id, e-mail, name, avatar — and nothing more", async () => {
    state.session = { id: "s1", account: ERIC };
    state.open = false;
    const res = await call();
    expect(await res.json()).toEqual({
      signedIn: true,
      signupOpen: false,
      account: { id: ERIC.id, email: ERIC.email, name: "Éric", avatarSeed: "plain-2" },
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("a maintenance that closes the app to this person reads as signed out", async () => {
    state.session = { id: "s1", account: ERIC };
    state.maintenance = true;
    expect((await (await call()).json()).signedIn).toBe(false);
  });

  it("is limited like the account's other reads: 429 past the window", async () => {
    state.session = { id: "s1", account: ERIC };
    let last = 200;
    for (let i = 0; i < 700; i += 1) last = (await call()).status;
    expect(last).toBe(429);
  });
});
