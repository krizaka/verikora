import { renderEmail } from "@krizaka/email";
import { describe, expect, it } from "vitest";

import { signupOpen } from "./env";
import type { AccountMail } from "./mailer";
import { isVerifyToken, newVerifyToken, signUp, signUpBody, VERIFY_TTL_HOURS, verifyEmail } from "./signup";

/** An in-memory stand-in for the two tables the sign-up touches. */
function fakeDb() {
  const accounts: { id: string; email: string; email_verified_at: Date | null; terms_version?: string }[] = [];
  const tokens: { account_id: string; token_hash: string; expires_at: Date; used_at: Date | null }[] = [];
  const mails: AccountMail[] = [];
  const query = async <T extends object>(text: string, values: unknown[] = []): Promise<T[]> => {
    if (text.startsWith("SELECT id, email_verified_at")) return accounts.filter((a) => a.email === values[0]) as T[];
    if (text.startsWith("INSERT INTO accounts")) {
      const a = { id: `acc-${accounts.length + 1}`, email: String(values[0]), email_verified_at: null, terms_version: String(values[3]) };
      accounts.push(a);
      return [{ id: a.id }] as T[];
    }
    if (text.startsWith("INSERT INTO email_verifications")) {
      tokens.push({ account_id: String(values[0]), token_hash: String(values[1]), expires_at: new Date((values[2] as Date).getTime() + Number(values[3]) * 3_600_000), used_at: null });
      return [];
    }
    if (text.startsWith("UPDATE email_verifications")) {
      const t = tokens.find((x) => x.token_hash === values[0] && !x.used_at && x.expires_at > (values[1] as Date));
      if (!t) return [];
      t.used_at = values[1] as Date;
      return [{ id: "v", account_id: t.account_id }] as T[];
    }
    if (text.startsWith("UPDATE accounts SET email_verified_at")) {
      accounts.find((a) => a.id === values[0])!.email_verified_at = values[1] as Date;
      return [];
    }
    throw new Error(`unexpected SQL: ${text}`);
  };
  return { accounts, tokens, mails, deps: { query, mail: async (m: AccountMail) => void mails.push(m), baseUrl: "https://www.yomizaka.com" } };
}
const input = signUpBody.parse({ email: " Eric@Example.com ", password: "correct horse battery", locale: "fr", acceptTerms: true, acceptPrivacy: true });

describe("sign-up", () => {
  it("refuses an account that has not accepted the terms and the privacy notice, or has a short password", () => {
    expect(signUpBody.safeParse({ ...input, acceptTerms: false }).success).toBe(false);
    expect(signUpBody.safeParse({ ...input, acceptPrivacy: false }).success).toBe(false);
    expect(signUpBody.safeParse({ ...input, password: "short" }).success).toBe(false);
    expect(input.email).toBe("eric@example.com");
  });

  it("creates an unverified account, records the consent version and mails one link that verifies it once", async () => {
    const db = fakeDb();
    const now = new Date("2026-10-21T12:00:00Z");
    await signUp(db.deps, input, now);
    expect(db.accounts).toHaveLength(1);
    expect(db.accounts[0]).toMatchObject({ email: "eric@example.com", email_verified_at: null, terms_version: expect.stringContaining("2026") });
    expect(db.mails).toHaveLength(1);
    expect(db.mails[0]).toMatchObject({ kind: "confirmEmail", to: "eric@example.com", locale: "fr", hours: VERIFY_TTL_HOURS });
    const token = decodeURIComponent(db.mails[0]!.url.match(/token=([^\s]+)/)![1]!);
    expect(isVerifyToken(token)).toBe(true);
    expect(db.tokens[0]!.expires_at.getTime() - now.getTime()).toBe(VERIFY_TTL_HOURS * 3_600_000);
    expect(db.tokens[0]!.token_hash).not.toContain(token); // only a keyed hash is kept
    expect(await verifyEmail({ query: db.deps.query }, token, now)).toBe("VERIFIED");
    expect(db.accounts[0]!.email_verified_at).toEqual(now);
    expect(await verifyEmail({ query: db.deps.query }, token, now)).toBe("INVALID"); // single use
  });

  it("refuses an expired link and a malformed one", async () => {
    const db = fakeDb();
    const now = new Date("2026-10-21T12:00:00Z");
    await signUp(db.deps, input, now);
    const token = decodeURIComponent(db.mails[0]!.url.match(/token=([^\s]+)/)![1]!);
    expect(await verifyEmail({ query: db.deps.query }, token, new Date(now.getTime() + (VERIFY_TTL_HOURS + 1) * 3_600_000))).toBe("INVALID");
    expect(await verifyEmail({ query: db.deps.query }, "nope", new Date())).toBe("INVALID");
  });

  it("does not reveal an existing account: nothing is created, nothing is sent", async () => {
    const db = fakeDb();
    db.accounts.push({ id: "acc-0", email: "eric@example.com", email_verified_at: new Date() });
    expect(await signUp(db.deps, input, new Date())).toEqual({ accountId: null });
    expect(db.mails).toHaveLength(0);
    expect(db.accounts).toHaveLength(1);
  });

  it("re-sends a link for an account that never confirmed, without a second account", async () => {
    const db = fakeDb();
    await signUp(db.deps, input, new Date());
    await signUp(db.deps, input, new Date());
    expect(db.accounts).toHaveLength(1);
    expect(db.mails).toHaveLength(2);
    expect(new Set(db.tokens.map((t) => t.token_hash)).size).toBe(2);
  });

  it("the mail promises nothing about the check, in its language: it confirms an address, in Yomizaka's brand and no other", async () => {
    for (const locale of ["fr", "en"] as const) {
      const mail = await renderEmail("confirmEmail", { brand: "yomizaka", confirmUrl: "https://www.yomizaka.com/fr/verify-email?token=x", hours: VERIFY_TTL_HOURS }, { locale });
      expect(mail.text).toContain("Yomizaka");
      expect(mail.text).not.toMatch(/conforme|compliant|garanti|guarantee|approuv|approved/i);
      expect(mail.html + mail.text).not.toMatch(/Orazaka|Orochia|Akinaza|Kachizaka|Yororis/);
    }
    expect(newVerifyToken()).not.toBe(newVerifyToken());
  });

  it("opens only when it is switched on AND the verification mail can be sent", () => {
    const mail = { MAIL_PROVIDER: "mailgun", MAIL_DOMAIN: "mg.example.com" };
    expect(signupOpen({})).toBe(false);
    expect(signupOpen({ AUTH_SIGNUP_ENABLED: "true" })).toBe(false); // no mail provider: stays closed
    expect(signupOpen({ AUTH_SIGNUP_ENABLED: "true", ...mail })).toBe(false); // no provider credential
    expect(signupOpen({ ...mail, MAIL_API_KEY: "x" })).toBe(false); // not switched on
    expect(signupOpen({ AUTH_SIGNUP_ENABLED: "true", ...mail, MAIL_API_KEY: "x" })).toBe(true);
  });
});
