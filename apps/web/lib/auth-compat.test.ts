import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "@krizaka/auth";
import { describe, expect, it, vi } from "vitest";

import { PASSWORD_MAX_LENGTH as CLIENT_MAX, PASSWORD_MIN_LENGTH as CLIENT_MIN } from "./password-policy";
import { isToken, newToken, tokenHash } from "./session";

vi.mock("./db", () => ({ query: async () => [] }));

/**
 * What the product stored BEFORE `@krizaka/auth` (verikora#263) must keep working: a password hash written by the former
 * `lib/password.ts`, a session token and the keyed hash the former `lib/session.ts` kept for it. The vectors were computed with the
 * former code (scrypt N=2^15 r=8 p=1; HMAC-SHA256 keyed `session:<secret>`): they never change.
 */
const STORED_HASH = "scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$9rcVF-DZ8uU77qz3H_v29-n2g8c877AOCRXSQvC_fs0";
const STORED_TOKEN = "ys1.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const STORED_TOKEN_HASH = "b2e72ccc308870de49be9c5d48fe3d8b0486ada7fad76fa9919c3fe94c4145fe";

describe("what was stored before the package still works", () => {
  it("verifies a password hash written by the former code, and refuses another password", async () => {
    expect(await verifyPassword("correct horse battery staple", STORED_HASH)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", STORED_HASH)).toBe(false);
  });

  it("writes the same format, which the stored one's reader accepts", async () => {
    const hash = await hashPassword("another long password");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("another long password", hash)).toBe(true);
  });

  it("keeps a session token valid: same shape, same keyed hash as the table holds", () => {
    expect(isToken(STORED_TOKEN)).toBe(true);
    expect(tokenHash(STORED_TOKEN, "s".repeat(32))).toBe(STORED_TOKEN_HASH);
    expect(isToken(newToken())).toBe(true);
    expect(newToken()).toMatch(/^ys1\.[A-Za-z0-9_-]{43}$/);
  });

  it("the browser-safe password lengths are the package's", () => {
    expect([CLIENT_MIN, CLIENT_MAX]).toEqual([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]);
  });
});
