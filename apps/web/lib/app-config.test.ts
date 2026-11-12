import { isAppConfigPayload } from "@krizaka/app-config";
import schema from "@krizaka/app-config/contract/app-config.schema.json" with { type: "json" };
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  mail: { MAIL_PROVIDER: "resend", MAIL_API_KEY: "k", MAIL_DOMAIN: "verikora.test" } as Record<string, string>,
}));

vi.mock("./settings/instance", () => ({
  appSettings: () => ({ get: async (key: string) => state.values[key] }),
}));
vi.mock("./env", () => ({ env: () => state.mail }));

import { GET } from "../app/api/app-config/route";
import { PRODUCT_NAME } from "./brand";

const defaults = () => ({
  "signup.open": false,
  "app.minVersion": "0.0.0",
  "app.latestVersion": "0.0.0",
  "app.maintenance": false,
  "app.maintenanceMessage": { fr: "En maintenance", en: "Down for maintenance" },
});

const call = (query = "?platform=web&version=1.0.0", headers: Record<string, string> = {}) =>
  GET(new Request(`https://www.verikora.com/api/app-config${query}`, { headers }));

/** The structural rules of the published JSON Schema, checked here without a validator dependency. */
function conforms(payload: Record<string, unknown>): string[] {
  const version = new RegExp(schema.$defs.version.pattern);
  const names = new RegExp(schema.properties.flags.propertyNames.pattern);
  const flags = Object.entries(payload.flags as Record<string, unknown>);
  return [
    ...schema.required.filter((key) => !(key in payload)).map((key) => `missing ${key}`),
    ...Object.keys(payload)
      .filter((key) => !(key in schema.properties))
      .map((key) => `extra ${key}`),
    ...["minSupportedVersion", "latestVersion"].filter((key) => !version.test(String(payload[key]))),
    ...flags
      .filter(([name, value]) => !names.test(name) || !["boolean", "number", "string"].includes(typeof value))
      .map(([name]) => `flag ${name}`),
    ...(new RegExp(schema.properties.locale.pattern).test(String(payload.locale)) ? [] : ["locale"]),
  ];
}

beforeEach(() => {
  state.values = defaults();
  state.mail = { MAIL_PROVIDER: "resend", MAIL_API_KEY: "k", MAIL_DOMAIN: "verikora.test" };
});

describe("GET /api/app-config", () => {
  it("answers the @krizaka/app-config contract, public and cacheable, with no personal data", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=60/);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as Record<string, unknown>;
    expect(isAppConfigPayload(body)).toBe(true);
    expect(conforms(body)).toEqual([]);
    expect(body.flags).toEqual({ signupOpen: false, productName: PRODUCT_NAME });
    expect(Object.keys(body).sort()).toEqual([...schema.required].sort());
  });

  it.each([
    [false, false],
    [true, true],
  ])("flags.signupOpen follows the setting (%s → %s)", async (setting, expected) => {
    state.values["signup.open"] = setting;
    const body = (await (await call()).json()) as { flags: { signupOpen: boolean } };
    expect(body.flags.signupOpen).toBe(expected);
  });

  it("stays false when the setting is on but no e-mail can be sent (the one function the sign-up route uses)", async () => {
    state.values["signup.open"] = true;
    state.mail = {};
    const body = (await (await call()).json()) as { flags: { signupOpen: boolean } };
    expect(body.flags.signupOpen).toBe(false);
  });

  it("reads the version bounds and the maintenance switch from the settings, never from code", async () => {
    state.values["app.minVersion"] = "1.4";
    state.values["app.latestVersion"] = "2.0.1";
    state.values["app.maintenance"] = true;
    const body = (await (await call("?platform=ios&version=1.0.0&locale=fr")).json()) as {
      minSupportedVersion: string;
      latestVersion: string;
      updateMode: string;
      maintenance: unknown;
    } & Record<string, unknown>;
    expect(conforms(body)).toEqual([]);
    expect(body.minSupportedVersion).toBe("1.4.0");
    expect(body.latestVersion).toBe("2.0.1");
    expect(body.updateMode).toBe("force");
    expect(body.maintenance).toEqual({ on: true, message: "En maintenance" });
  });

  it("falls back to no minimum when a version setting is not a version", async () => {
    state.values["app.minVersion"] = "soon";
    const body = (await (await call()).json()) as Record<string, unknown>;
    expect(body.minSupportedVersion).toBe("0.0.0");
  });

  it("refuses an unknown platform and answers 304 to a matching ETag", async () => {
    expect((await call("?platform=amiga")).status).toBe(400);
    const first = await call();
    const again = await call("?platform=web&version=1.0.0", { "if-none-match": first.headers.get("etag") ?? "" });
    expect(again.status).toBe(304);
  });
});
