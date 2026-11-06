import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "../limits";
import { maskKey } from "../sovkora-status";
import { CONFIG_PAGE, CONFIG_PAGES, isConfigPage, isSettingsGroup } from "./admin-config";

const state = vi.hoisted(() => ({ role: "ADMIN" as "ADMIN" | "USER" | null, writes: [] as string[] }));

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
vi.mock("../audit", () => ({ audit: async () => undefined }));
vi.mock("../db", () => ({
  query: async (text: string) => {
    if (/^(INSERT|DELETE)/.test(text)) state.writes.push(text.split(" ")[2] ?? "");
    return [];
  },
}));

const json = (method: string, body?: unknown) =>
  new Request("https://admin.verikora.com/api/admin/settings", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.20", "content-type": "application/json" },
  });

beforeEach(() => {
  resetRateLimits();
  state.role = "ADMIN";
  state.writes = [];
});

describe("the configuration API is the administration's only", () => {
  it.each([null, "USER"] as const)("refuses %s", async (role) => {
    state.role = role;
    const { PUT, GET } = await import("../../app/api/admin/settings/route");
    expect((await PUT(json("PUT", { scope: "global", key: "app.maintenance", value: true }))).status).toBe(
      role ? 403 : 401,
    );
    expect((await GET(json("GET"))).status).toBe(role ? 403 : 401);
    expect(state.writes).toEqual([]);
  });

  it.each([
    ["a value that is not valid", { scope: "global", key: "limits.maxFileMb", value: 99 }, 400, "BAD_VALUE"],
    ["a setting that does not exist", { scope: "global", key: "nothing.here", value: true }, 404, "UNKNOWN_SETTING"],
    [
      "a scope the setting cannot be set at",
      { scope: "user", id: "u1", key: "app.maintenance", value: true },
      400,
      "BAD_SCOPE",
    ],
    [
      "a person scope without a person",
      { scope: "user", id: "", key: "features.assistant", value: true },
      400,
      "BAD_SCOPE",
    ],
  ] as const)("refuses %s with its stable code, and writes nothing", async (_name, body, status, code) => {
    const { PUT } = await import("../../app/api/admin/settings/route");
    const res = await PUT(json("PUT", body));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
    expect(state.writes).toEqual([]);
  });

  it("accepts a valid change and records it", async () => {
    const { PUT } = await import("../../app/api/admin/settings/route");
    expect((await PUT(json("PUT", { scope: "global", key: "app.maintenance", value: true }))).status).toBe(200);
    expect(state.writes).toEqual(["app_settings", "settings_audit"]);
  });
});

describe("the configuration pages", () => {
  it("are the setting groups then the price catalogue, the packs, Sovkora and the organisation, each a route", () => {
    expect(CONFIG_PAGES).toEqual([
      "general",
      "features",
      "limits",
      "plans",
      "prices",
      "coupons",
      "packs",
      "sovkora",
      "organisation",
    ]);
    expect(isSettingsGroup(CONFIG_PAGE.prices)).toBe(false);
    expect(isConfigPage("limits")).toBe(true);
    expect(isConfigPage("secrets")).toBe(false);
    expect(isSettingsGroup(CONFIG_PAGE.general)).toBe(true);
    expect(isSettingsGroup(CONFIG_PAGE.packs)).toBe(false);
  });
});

describe("the Sovkora key is never shown", () => {
  it.each([
    ["oz_live_abcdefghijklmnop", "oz_••••••••mnop"],
    ["sk-1234567890abcdef", "sk-••••••••cdef"],
  ])("%s", (key, masked) => {
    expect(maskKey(key)).toEqual({ configured: true, masked });
    expect(maskKey(key).masked).not.toContain(key.slice(4, -4));
  });
  it("says when there is none", () => expect(maskKey(undefined)).toEqual({ configured: false, masked: null }));
});
