import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  deleteAccount,
  exportAccount,
  revokeUserSessions,
  setUserPlan,
  setUserRole,
  userDetail,
} from "./admin";
import { entitlementOf } from "./billing";
import { migrate, pool, query } from "./db";
import { databaseBudget, poolUsage, queue, recentErrors, rulesetsInUse } from "./operations";
import { createSession } from "./session";

/** The administration's account actions against a real PostgreSQL (see db.integration.test.ts for how to run it). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("administration of an account", () => {
  const stamp = Date.now();
  let admin: { id: string; email: string };
  let person: { id: string; email: string };

  beforeAll(async () => {
    await migrate();
    const make = async (email: string, role: string) =>
      (
        await query<{ id: string }>(
          "INSERT INTO accounts (email, role, password_hash) VALUES ($1, $2, 'x') RETURNING id",
          [email, role],
        )
      )[0]!.id;
    admin = { id: await make(`adm-${stamp}@verikora.test`, "ADMIN"), email: `adm-${stamp}@verikora.test` };
    person = { id: await make(`per-${stamp}@verikora.test`, "USER"), email: `per-${stamp}@verikora.test` };
  });
  afterAll(async () => {
    await query("DELETE FROM accounts WHERE id = ANY($1)", [[admin.id, person.id]]);
    await pool().end();
  });

  it("grants and withdraws the role, never on yourself, and says so in the audit log", async () => {
    await expect(setUserRole(admin, admin.id, "USER")).rejects.toMatchObject({ status: 409 });
    expect((await setUserRole(admin, person.id, "ADMIN")).role).toBe("ADMIN");
    expect((await setUserRole(admin, person.id, "USER")).role).toBe("USER");
    expect((await auditLog(10, person.id)).filter((e) => e.action === "admin.user_role_changed")).toHaveLength(2);
  });

  it("puts an account on Pro without a card and back on Free, says so in the audit log, and the entitlement follows (verikora#252)", async () => {
    expect((await setUserPlan(admin, person.id, "PRO", "dev")).plan).toBe("PRO");
    expect((await entitlementOf(query, person.id, new Date())).pro).toBe(true);
    expect((await setUserPlan(admin, person.id, "FREE", "dev")).plan).toBe("FREE");
    expect((await entitlementOf(query, person.id, new Date())).pro).toBe(false);
    expect((await auditLog(10, person.id)).filter((e) => e.action === "admin.user_plan_changed")).toHaveLength(2);
    await expect(setUserPlan(admin, person.id, "PRO", "prod")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("development environment"),
    });
    await expect(setUserPlan(admin, "not-an-id", "PRO", "dev")).rejects.toMatchObject({ status: 404 });
  });

  it("ends every session without suspending the account", async () => {
    await createSession(person.id, { ip: "203.0.113.7", userAgent: "vitest" });
    await createSession(person.id, { ip: "203.0.113.8", userAgent: "vitest" });
    const out = await revokeUserSessions(admin, person.id);
    expect(out.revoked).toBe(2);
    expect(out.user).toMatchObject({ sessions: 0, status: "ACTIVE" });
  });

  it("exports the account without its password hash or its files", async () => {
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 'Lease', 'l.txt', 'text/plain', 4, $2, 'bail', 'bail') RETURNING id",
      [person.id, `sha-${stamp}`],
    );
    await query(
      "INSERT INTO analyses (document_id, studio, status, run_id) VALUES ($1, 'compliance-check', 'failed', 'run-x')",
      [doc!.id],
    );
    const out = await exportAccount(admin, person.id);
    const text = JSON.stringify(out);
    expect(text).not.toContain("password");
    expect(text).not.toContain('"content"');
    expect(out).toMatchObject({
      format: "verikora-account-export/1",
      account: { email: person.email },
      documents: [{ title: "Lease" }],
      analyses: [{ studio: "compliance-check", status: "failed" }],
    });
    expect((await auditLog(10, person.id)).map((e) => e.action)).toContain("admin.account_exported");
  });

  it("erases the account and what it owns after a typed confirmation; the audit keeps the fact, not the person", async () => {
    await expect(deleteAccount(admin, admin.id, admin.email)).rejects.toMatchObject({
      status: 409,
      body: { code: "SELF_DELETE" },
    });
    await expect(deleteAccount(admin, person.id, "someone@else.test")).rejects.toMatchObject({
      status: 409,
      body: { code: "CONFIRM_MISMATCH" },
    });
    expect((await userDetail(person.id)).documents).toBe(1);
    await query(
      "INSERT INTO audit_log (actor_id, actor_label, action, target_id, ip) VALUES ($1, $2, 'auth.sign_in', $3, '203.0.113.7')",
      [person.id, person.email, `sign-in-${person.id}`],
    );
    expect(await deleteAccount(admin, person.id, person.email.toUpperCase())).toEqual({ deleted: true, documents: 1 });
    await expect(userDetail(person.id)).rejects.toMatchObject({ status: 404 });
    expect(await query("SELECT 1 FROM documents WHERE owner_id = $1", [person.id])).toEqual([]);
    // The package's table clears the actor with the account (ON DELETE SET NULL): the entry is found by its target, no longer by the person.
    const rows = await query<{ actor_label: string; ip: string | null; actor_id: string | null }>(
      "SELECT actor_label, ip, actor_id FROM audit_log WHERE target_id = $1",
      [`sign-in-${person.id}`],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toEqual({ actor_label: "deleted account", ip: null, actor_id: null });
    expect(
      (
        await query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'admin.account_deleted' AND target_id = $1",
          [person.id],
        )
      )[0]!.n,
    ).toBe("1");
  });

  it("reads the operations page's figures from the real tables", async () => {
    const budget = await databaseBudget();
    expect(budget.open).toBeGreaterThan(0);
    expect(budget.limit).toBeGreaterThan(0);
    expect(typeof (await queue()).stuck).toBe("number");
    expect(Array.isArray(await recentErrors())).toBe(true);
    expect(Array.isArray(await rulesetsInUse())).toBe(true);
    expect(poolUsage().max).toBe(5);
  });
});
