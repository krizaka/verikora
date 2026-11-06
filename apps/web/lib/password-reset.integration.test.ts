import { postgresAccounts } from "@krizaka/auth";
import { hashPassword, verifyPassword } from "@krizaka/auth";
import { addMinutes } from "date-fns";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { audit } from "./audit";
import { migrate, query, transaction } from "./db";
import { resetRateLimits } from "./limits";
import { applyReset, requestReset } from "./password-reset";
import { createSession, resolveSession, tokenHash } from "./session";

/**
 * The forgot-password flow against a real PostgreSQL 16 (CI's service; locally `DATABASE_IT=1 DATABASE_URL=… pnpm test`):
 * the same answer for a known and an unknown address, an expired and a reused link refused, the other sessions ended, and
 * an audit trail that holds neither a link nor a new secret. Skipped without a database.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("the forgot-password flow", () => {
  const stamp = Date.now();
  const email = `reset-${stamp}@verikora.test`;
  const OLD = "the old secret 123";
  const NEW = "the brand new secret 456";
  const headers = new Headers({ "x-forwarded-for": "203.0.113.20" });
  const mails: { to: string; text: string }[] = [];
  let id = "";

  const accounts = (passwordResetTtlMinutes?: number) =>
    postgresAccounts({
      query: async (sql, params) => query(sql, params) as never,
      transaction: (work) => transaction((run) => work(run as never)),
      mail: async (m) => void mails.push({ to: m.to, text: m.text }),
      baseUrl: "https://app.example.test",
      product: "Verikora",
      tokenPrefix: "ye",
      tokenHash: (token) => tokenHash(token),
      passwords: { hash: hashPassword, verify: verifyPassword },
      passwordResetTtlMinutes,
    });
  const deps = (ttl?: number) => ({ accounts: accounts(ttl), audit });
  /** The link the last mail carries. */
  const linkToken = () => decodeURIComponent(/token=([^\s&]+)/.exec(mails.at(-1)!.text)![1]!);
  const asked = async (ttl?: number, now = new Date()) => {
    mails.length = 0;
    await requestReset(deps(ttl), { email }, { headers }, now);
    return linkToken();
  };
  const hashOf = async () =>
    (
      (await query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE id = $1", [id])) as [
        { password_hash: string },
      ]
    )[0].password_hash;

  beforeAll(async () => {
    await migrate();
    [{ id }] = (await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, $2, now()) RETURNING id",
      [email, await hashPassword(OLD)],
    )) as [{ id: string }];
  });
  beforeEach(() => resetRateLimits());

  it("answers the same for a known and an unknown address, and mails only the known one", async () => {
    mails.length = 0;
    const known = await requestReset(deps(), { email }, { headers }, new Date());
    const unknown = await requestReset(deps(), { email: `nobody-${stamp}@verikora.test` }, { headers }, new Date());
    expect(known).toEqual(unknown);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(email);
  });

  it("sets the new password, uses the link up and ends every session", async () => {
    const [a, b] = await Promise.all([
      createSession(id, { ip: null, userAgent: null }),
      createSession(id, { ip: null, userAgent: null }),
    ]);
    expect(await resolveSession(a.token)).not.toBeNull();
    const token = await asked();
    await applyReset(deps(), { token, password: NEW }, { headers }, new Date());
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    const stored = await hashOf();
    expect(await verifyPassword(NEW, stored)).toBe(true);
    expect(await verifyPassword(OLD, stored)).toBe(false);
  });

  it("refuses the same link a second time", async () => {
    const token = await asked();
    await applyReset(deps(), { token, password: "another secret value 789" }, { headers }, new Date());
    await expect(applyReset(deps(), { token, password: NEW }, { headers }, new Date())).rejects.toMatchObject({
      status: 400,
      body: { code: "RESET_INVALID" },
    });
  });

  it("refuses a link past its lifetime — 30 minutes by default — and honours it just before", async () => {
    const now = new Date();
    const late = await asked(undefined, now);
    await expect(
      applyReset(deps(), { token: late, password: NEW }, { headers }, addMinutes(now, 31)),
    ).rejects.toMatchObject({ body: { code: "RESET_INVALID" } });
    const inTime = await asked(undefined, now);
    await expect(
      applyReset(deps(), { token: inTime, password: NEW }, { headers }, addMinutes(now, 29)),
    ).resolves.toEqual({ ok: true });
  });

  it("follows the configured lifetime: a 5-minute link is dead at 6 minutes, a 120-minute one lives at 60", async () => {
    const now = new Date();
    const short = await asked(5, now);
    await expect(
      applyReset(deps(5), { token: short, password: NEW }, { headers }, addMinutes(now, 6)),
    ).rejects.toMatchObject({ body: { code: "RESET_INVALID" } });
    const long = await asked(120, now);
    expect(mails.at(-1)!.text).toContain("120 min");
    await expect(
      applyReset(deps(120), { token: long, password: NEW }, { headers }, addMinutes(now, 60)),
    ).resolves.toEqual({ ok: true });
  });

  it("a new request retires the earlier link", async () => {
    const first = await asked();
    const second = await asked();
    await expect(applyReset(deps(), { token: first, password: NEW }, { headers }, new Date())).rejects.toMatchObject({
      body: { code: "RESET_INVALID" },
    });
    await expect(applyReset(deps(), { token: second, password: NEW }, { headers }, new Date())).resolves.toEqual({
      ok: true,
    });
  });

  it("does not use the link up on a value that is too short", async () => {
    const token = await asked();
    await expect(applyReset(deps(), { token, password: "short" }, { headers }, new Date())).rejects.toMatchObject({
      status: 400,
      body: { code: "PASSWORD_TOO_SHORT" },
    });
    await expect(applyReset(deps(), { token, password: NEW }, { headers }, new Date())).resolves.toEqual({ ok: true });
  });

  it("keeps neither a link nor the new secret in the audit trail — one line per request and per reset", async () => {
    const chosen = "audit secret value 000 zzz";
    const token = await asked();
    await applyReset(deps(), { token, password: chosen }, { headers }, new Date());
    const lines = await query<{ action: string; detail: unknown; actor_label: string }>(
      "SELECT action, detail, actor_label FROM audit_log WHERE action IN ('auth.password_reset_requested', 'auth.password_reset')",
    );
    expect(lines.filter((l) => l.action === "auth.password_reset_requested").length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.action === "auth.password_reset").length).toBeGreaterThan(0);
    const written = JSON.stringify(lines);
    expect(written).not.toContain(token);
    expect(written).not.toContain(chosen);
    expect(written).not.toContain(email);
    expect(written).not.toMatch(/ye1\./);
  });
});
