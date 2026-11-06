import { DEFAULT_MAX_KEYS } from "@krizaka/rate-limit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { limit, limitWith, resetRateLimits } from "./limits";
import { LIMIT_DEFAULTS } from "./settings/limits";
import { SETTINGS } from "./settings/registry";

// The settings are read like the real service does: a key the registry does not declare throws, a declared one answers (an override, else the default).
const settings = vi.hoisted(() => ({ overrides: {} as Record<string, number>, down: false }));
vi.mock("./settings/instance", async () => {
  const { SETTINGS } = await import("./settings/registry");
  return {
    appSettings: () => ({
      get: async (key: string) => {
        if (settings.down) throw new Error("no database");
        if (!(key in SETTINGS)) throw new TypeError("Cannot read properties of undefined (reading 'scopes')");
        return settings.overrides[key] ?? (SETTINGS as unknown as Record<string, { default: number }>)[key]!.default;
      },
    }),
  };
});
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));

const from = (ip: string) => ({ headers: new Headers({ "x-forwarded-for": ip }) });
const refused = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as {
      status: number;
      body: { code: string; retryAfterSeconds: number };
      headers: Record<string, string>;
    };
  }
  return null;
};

describe("the API's action limits (@krizaka/rate-limit)", () => {
  beforeEach(() => {
    resetRateLimits();
    settings.overrides = {};
    settings.down = false;
  });

  it("counts per address and per subject: the 11th sign-in of an address is a 429 with its code and Retry-After", async () => {
    const req = from("203.0.113.7");
    for (let i = 0; i < 10; i += 1) await limit("signIn", req, i % 2 ? "A@B.C" : "a@b.c");
    const error = await refused(() => limit("signIn", req, "a@B.c"));
    expect(error?.status).toBe(429);
    expect(error?.body.code).toBe("RATE_LIMITED");
    expect(Number(error?.headers["Retry-After"])).toBeGreaterThan(0);
    expect(Number(error?.headers["Retry-After"])).toBeLessThanOrEqual(900);
    // another account from the same address still passes, a refused one stays refused
    await limit("signIn", req, "other@b.c");
    expect((await refused(() => limit("signIn", req, "a@b.c")))?.status).toBe(429);
  });

  it("limits an address without a subject, and keeps each address apart", async () => {
    for (let i = 0; i < 60; i += 1) await limit("verify", from("198.51.100.1"), null);
    expect((await refused(() => limit("verify", from("198.51.100.1"), null)))?.status).toBe(429);
    await limit("verify", from("198.51.100.2"), null);
  });

  it("counts each account scope apart under the same read and write limits", async () => {
    const req = from("203.0.113.9");
    for (let i = 0; i < 15; i += 1) await limit("accountWrite", req, "acc-1", "profile");
    expect((await refused(() => limit("accountWrite", req, "acc-1", "profile")))?.status).toBe(429);
    await limit("accountWrite", req, "acc-1", "password");
    for (let i = 0; i < 31; i += 1) await limit("accountRead", req, "acc-2", "profile");
  });

  it("limits an API key by its owner's per-minute allowance", async () => {
    const req = from("203.0.113.11");
    for (let i = 0; i < 3; i += 1) await limitWith("apiKey", req, "key-1", 6, 3, 60);
    const error = await refused(() => limitWith("apiKey", req, "key-1", 6, 3, 60));
    expect(error?.body.code).toBe("RATE_LIMITED");
  });

  it("keeps a blocked caller blocked when the store is flooded with distinct keys (verikora#46)", async () => {
    const attacker = from("203.0.113.66");
    for (let i = 0; i < 6; i += 1) await refused(() => limit("signUp", attacker, null));
    expect((await refused(() => limit("signUp", attacker, null)))?.status).toBe(429);
    for (let i = 0; i < DEFAULT_MAX_KEYS + 50; i += 1) await limit("showcase", from(`10.${i >> 8}.${i & 255}.1`), null);
    expect((await refused(() => limit("signUp", attacker, null)))?.status).toBe(429);
  });

  it("reads the administrator's numbers, also for an action that has no per-subject limit", async () => {
    settings.overrides = { "limits.verify.perIp": 2, "limits.signIn.perSubject": 1 };
    const req = from("203.0.113.21");
    await limit("verify", req, null);
    await limit("verify", req, null);
    expect((await refused(() => limit("verify", req, null)))?.status).toBe(429);
    await limit("signIn", from("203.0.113.22"), "x@y.z");
    expect((await refused(() => limit("signIn", from("203.0.113.22"), "x@y.z")))?.status).toBe(429);
  });

  it("falls back to today's numbers when the settings cannot be read: a limit is never removed", async () => {
    settings.down = true;
    const req = from("203.0.113.23");
    for (let i = 0; i < 5; i += 1) await limit("signUp", req, null);
    expect((await refused(() => limit("signUp", req, null)))?.status).toBe(429);
  });

  it("has a setting for every number: today's values as defaults, windows included", () => {
    for (const [action, defaults] of Object.entries(LIMIT_DEFAULTS) as [
      string,
      { perIp: number; perSubject?: number; windowSeconds: number },
    ][]) {
      expect(SETTINGS[`limits.${action}.perIp` as keyof typeof SETTINGS].default).toBe(defaults.perIp);
      expect(SETTINGS[`limits.${action}.windowSeconds` as keyof typeof SETTINGS].default).toBe(defaults.windowSeconds);
      expect(`limits.${action}.perSubject` in SETTINGS).toBe(defaults.perSubject !== undefined);
    }
  });
});
