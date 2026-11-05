import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ setting: false, signUps: 0 }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./settings/guards", () => ({ assertOpen: async () => undefined }));
vi.mock("./settings/instance", () => ({ appSettings: () => ({ get: async () => state.setting }) }));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));
vi.mock("./db", () => ({ query: async () => [] }));
vi.mock("./mailer", () => ({ mailerFor: () => async () => undefined }));
vi.mock("./signup", async (orig) => ({
  ...(await orig<typeof import("./signup")>()),
  signUp: async () => void (state.signUps += 1),
}));

import { POST } from "../app/api/auth/sign-up/route";
import { SETTINGS } from "./settings/registry";

const MAIL = { MAIL_PROVIDER: "mailgun", MAIL_API_KEY: "k", MAIL_DOMAIN: "mg.example.test" };
const body = JSON.stringify({
  email: "eric@example.test",
  password: "correct horse battery",
  locale: "fr",
  acceptTerms: true,
  acceptPrivacy: true,
});
const call = () =>
  POST(
    new Request("https://dev.yomizaka.test/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body,
    }),
  );

describe("sign-up is closed by default (krizaka-internal#2405)", () => {
  beforeEach(() => {
    state.setting = false;
    state.signUps = 0;
    vi.unstubAllEnvs();
    for (const [k, v] of Object.entries(MAIL)) {
      vi.stubEnv(k, v);
    }
  });

  it("the setting's default is closed", () => {
    expect(SETTINGS["signup.open"].default).toBe(false);
  });

  it("answers 403 SIGNUP_CLOSED and creates nothing while the setting is off, mail or not", async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code ?? (await res.clone().text())).toContain("SIGNUP_CLOSED");
    expect(state.signUps).toBe(0);
  });

  it("stays closed when the setting is on but the verification e-mail cannot be sent", async () => {
    state.setting = true;
    vi.unstubAllEnvs();
    vi.stubEnv("MAIL_PROVIDER", undefined);
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.signUps).toBe(0);
  });
});

describe("the deploy file ships sign-up closed", () => {
  const spec = readFileSync(join(__dirname, "../../../deploy/digitalocean/dev.app.yaml"), "utf8");
  it("AUTH_SIGNUP_ENABLED is declared and false", () => {
    const line = spec.split("\n").find((l) => !l.trim().startsWith("#") && l.includes("AUTH_SIGNUP_ENABLED"));
    expect(line, "AUTH_SIGNUP_ENABLED is declared").toBeDefined();
    expect(line).toMatch(/value:\s*"false"/);
  });
});
