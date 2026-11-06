import { describe, expect, it } from "vitest";

import { assertProductionEnv, consoleAllowedIps, envSchema, productionProblems, readEnv } from "./env";
import { generateSigningKeyBase64 } from "./report-key";

const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://verikora_db:x@db.example:25060/verikora_db?sslmode=require",
  DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----",
  AUTH_SESSION_SECRET: "a".repeat(40),
  AI_API_KEY: "oz_live_key",
  APP_REPORT_SIGNING_KEY: generateSigningKeyBase64(),
};

describe("env", () => {
  it("has no switch that re-opens public verification (ADR-0002): only a member with a grant verifies", () => {
    expect(Object.keys(envSchema.shape)).not.toContain("APP_PUBLIC_ACTIONS");
  });

  it("holds no price and no included volume: they are the price catalogue's (ADR-009, verikora#367)", () => {
    for (const gone of ["PAYMENTS_PRICE_KEY_AUDIT", "PAYMENTS_PRICE_KEY_PRO", "APP_FAIR_USE_AUDITS_PER_MONTH"])
      expect(Object.keys(envSchema.shape)).not.toContain(gone);
  });

  it("declares the demo seed credentials under the app context", () => {
    expect(
      readEnv({ APP_DEMO_ACCOUNT_EMAIL: "demo@example.test", APP_DEMO_ACCOUNT_PASSWORD: "long-enough-password" }),
    ).toMatchObject({
      APP_DEMO_ACCOUNT_EMAIL: "demo@example.test",
      APP_DEMO_ACCOUNT_PASSWORD: "long-enough-password",
    });
  });

  it("closes sign-up unless AUTH_SIGNUP_ENABLED is exactly true", () => {
    expect(readEnv({}).AUTH_SIGNUP_ENABLED).toBe(false);
    expect(readEnv({ AUTH_SIGNUP_ENABLED: "yes" }).AUTH_SIGNUP_ENABLED).toBe(false);
    expect(readEnv({ AUTH_SIGNUP_ENABLED: "TRUE" }).AUTH_SIGNUP_ENABLED).toBe(true);
  });

  it("runs the analyses on Sovkora only", () => {
    expect(readEnv({}).AI_PROVIDER).toBe("sovkora");
    expect(() => readEnv({ AI_PROVIDER: "openai" })).toThrow();
    expect(readEnv({}).AI_API_URL).toBe("https://dev.sovkora.com/edge");
  });

  it("refuses a production start without its secrets, naming them, never showing them", () => {
    expect(() => assertProductionEnv(PROD)).not.toThrow();
    const problems = productionProblems(
      readEnv({ NODE_ENV: "production", AI_API_KEY: "sk-not-sovkora", DATABASE_URL: PROD.DATABASE_URL }),
    );
    expect(problems).toEqual([
      "AUTH_SESSION_SECRET must be at least 32 characters",
      "AI_API_KEY must be an Sovkora key (oz_…)",
      "APP_REPORT_SIGNING_KEY is not set",
      "DATABASE_CA_CERT is required for a TLS database",
    ]);
    expect(problems.join(" ")).not.toContain("sk-not-sovkora");
    expect(productionProblems(readEnv({}))).toEqual([]);
  });

  it("refuses a production start without a usable report signing key, never showing it", () => {
    expect(productionProblems(readEnv({ ...PROD, APP_REPORT_SIGNING_KEY: undefined }))).toEqual([
      "APP_REPORT_SIGNING_KEY is not set",
    ]);
    const problems = productionProblems(readEnv({ ...PROD, APP_REPORT_SIGNING_KEY: "garbage-SECRETVALUE" }));
    expect(problems).toEqual(["APP_REPORT_SIGNING_KEY is not a base64 PKCS#8 private key"]);
    expect(problems.join(" ")).not.toContain("SECRETVALUE");
  });

  it("lets nobody into the administration in production without an allow-list", () => {
    expect(consoleAllowedIps({ NODE_ENV: "production" })).toEqual([]);
    expect(consoleAllowedIps({ NODE_ENV: "production", AUTH_ALLOWED_IPS: "203.0.113.7, 198.51.100.2" })).toEqual([
      "203.0.113.7",
      "198.51.100.2",
    ]);
    expect(consoleAllowedIps({ NODE_ENV: "development" })).toBeNull();
  });
});
