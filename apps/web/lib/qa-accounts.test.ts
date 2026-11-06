import { verifyPassword } from "@krizaka/auth";
import { describe, expect, it } from "vitest";

// A plain ES module script (scripts/qa-accounts.mjs), tested here so its hashes stay readable by the app.
import { accountsFromEnv, hashPassword } from "../scripts/qa-accounts.mjs";

describe("the QA accounts script", () => {
  it("hashes passwords the app verifies", async () => {
    const hash: string = await hashPassword("a long enough password");
    expect(await verifyPassword("a long enough password", hash)).toBe(true);
    expect(await verifyPassword("another one entirely", hash)).toBe(false);
  });

  it("asks for both accounts, valid addresses, passwords of 12 characters", () => {
    const env = {
      QA_USER_EMAIL: "QA+User@Verikora.com",
      QA_USER_PASSWORD: "x".repeat(16),
      QA_ADMIN_EMAIL: "qa+admin@verikora.com",
      QA_ADMIN_PASSWORD: "y".repeat(16),
    };
    expect(accountsFromEnv(env).map((a: { email: string; role: string }) => [a.email, a.role])).toEqual([
      ["qa+user@verikora.com", "USER"],
      ["qa+admin@verikora.com", "ADMIN"],
    ]);
    expect(accountsFromEnv(env).map((a: { name: string }) => a.name)).toEqual(["Éric Tremblay", "Mira Haddad"]);
    expect(() => accountsFromEnv({ ...env, QA_ADMIN_PASSWORD: "short" })).toThrow(/ADMIN password/);
    expect(() => accountsFromEnv({ ...env, QA_USER_EMAIL: undefined })).toThrow(/USER/);
  });
});
