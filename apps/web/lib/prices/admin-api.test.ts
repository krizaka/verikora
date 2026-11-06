import { memoryPriceStore, priceCatalogue } from "@krizaka/settings";
import { addDays } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "../limits";
import { PRICE, PRICES } from "../pricing";

const state = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "USER" | null,
  trail: [] as string[],
  env: {} as Record<string, string>,
}));
const prices = vi.hoisted(() => ({ catalogue: null as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("../session", async (orig) => ({
  ...(await orig<typeof import("../session")>()),
  resolveSession: async () =>
    state.role
      ? {
          id: "s1",
          account: {
            id: "22222222-2222-4222-8222-222222222222",
            email: "admin@verikora.test",
            role: state.role,
            locale: "fr",
            perspective: null,
            name: null,
            avatarSeed: null,
          },
        }
      : null,
}));
vi.mock("../audit", () => ({ audit: async (e: { action: string }) => void state.trail.push(e.action) }));
vi.mock("../db", () => ({ query: async () => [] }));
vi.mock("../env", async (orig) => ({ ...(await orig<typeof import("../env")>()), env: () => state.env }));
vi.mock("./catalogue", () => ({ appPrices: () => prices.catalogue }));

const req = (method: string, body?: unknown) =>
  new Request("https://admin.verikora.com/api/admin/prices", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.20", "content-type": "application/json" },
  });
const LATER = addDays(new Date(), 30).toISOString();

beforeEach(() => {
  resetRateLimits();
  state.role = "ADMIN";
  state.trail = [];
  state.env = {};
  prices.catalogue = priceCatalogue(PRICES, memoryPriceStore());
});

describe("the price catalogue's admin API (verikora#367)", () => {
  it.each([null, "USER"] as const)("refuses %s", async (role) => {
    state.role = role;
    const { GET, POST } = await import("../../app/api/admin/prices/route");
    expect((await GET(req("GET"))).status).toBe(role ? 403 : 401);
    expect((await POST(req("POST", { key: PRICE.agency, amountCents: 6900 }))).status).toBe(role ? 403 : 401);
    expect(state.trail).toEqual([]);
  });

  it("lists every entry, the internal one included, with its history", async () => {
    const { GET } = await import("../../app/api/admin/prices/route");
    const body = await (await GET(req("GET"))).json();
    expect(body.entries.map((e: { key: string }) => e.key)).toContain(PRICE.api);
    expect(body.history[PRICE.agency].at(-1)).toMatchObject({ actorLabel: "seed", after: { amountCents: 4900 } });
    expect(body.processor).toEqual({ mode: null, amounts: {} });
  });

  it("schedules a change from a date: in force from then, kept in the history, one line in the trail", async () => {
    const { GET, POST } = await import("../../app/api/admin/prices/route");
    const res = await POST(req("POST", { key: PRICE.agency, amountCents: 6900, effectiveFrom: LATER }));
    expect(res.status).toBe(200);
    expect(state.trail).toEqual(["prices.scheduled"]);
    const body = await (await GET(req("GET"))).json();
    const agency = body.entries.find((e: { key: string }) => e.key === PRICE.agency);
    expect(agency.amountCents).toBe(4900);
    expect(agency.upcoming).toEqual([expect.objectContaining({ amountCents: 6900, effectiveFrom: LATER })]);
    expect(body.history[PRICE.agency][0]).toMatchObject({
      actorLabel: "admin@verikora.test",
      before: { amountCents: 4900 },
      after: { amountCents: 6900 },
    });
  });

  it.each([
    [
      "a date in the past",
      { key: PRICE.agency, amountCents: 6900, effectiveFrom: "2020-01-01T00:00:00Z" },
      400,
      "BAD_DATE",
    ],
    ["an unknown entry", { key: "verikora.gold", amountCents: 100 }, 404, "UNKNOWN_PRICE"],
    ["an entry on sale without a figure", { key: PRICE.document, amountCents: null }, 400, "BAD_VALUE"],
  ])("refuses %s with its code", async (_, body, status, code) => {
    const { POST } = await import("../../app/api/admin/prices/route");
    const res = await POST(req("POST", body));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
    expect(state.trail).toEqual([]);
  });

  it("syncs the processor (#548): refused for a member, payments off and a live key are named and never written", async () => {
    const { POST } = await import("../../app/api/admin/prices/sync/route");
    state.role = "USER";
    expect((await POST(req("POST"))).status).toBe(403);
    state.role = "ADMIN";
    expect((await (await POST(req("POST"))).json()).code).toBe("PAYMENTS_OFF");
    state.env = { PAYMENTS_PROVIDER: "stripe", PAYMENTS_STRIPE_SECRET_KEY: "sk_live_none" };
    const live = await POST(req("POST"));
    expect(live.status).toBe(409);
    expect((await live.json()).code).toBe("LIVE_PRICES_ARE_THE_OWNERS");
    expect(state.trail).toEqual([]);
  });

  it("a change that applies now says the processor was not touched when payments are off", async () => {
    const { POST } = await import("../../app/api/admin/prices/route");
    expect(await (await POST(req("POST", { key: PRICE.agency, amountCents: 5900 }))).json()).toMatchObject({
      sync: "off",
    });
  });
});
