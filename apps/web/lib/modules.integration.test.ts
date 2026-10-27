import { assertModules, migrate as runMigrations } from "@krizaka/db";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { MIGRATION_LOCK_KEY } from "./db";
import { MIGRATIONS } from "./migrations";
import { ADOPTED, MODULES } from "./modules";

/** A database migrated by `main` (before 0036) takes markers only (skipped without YOMIZAKA_DB_IT=1 and DATABASE_URL). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("adopted Krizaka modules", () => {
  it("adds markers only to a database that ran the product's own SQL", async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const name = `b52_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    const connect = async () => {
      const client = await pool.connect();
      return { query: (text: string, values?: unknown[]) => client.query(text, values), release: () => client.release() };
    };
    const columns = async () =>
      (await pool.query("SELECT table_schema || '.' || table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1")).rows.map(
        (r: { c: string }) => r.c,
      );
    try {
      await runMigrations(connect, MIGRATIONS.filter((m) => m.version < "0036"), { lockKey: MIGRATION_LOCK_KEY });
      const before = await columns();
      const applied = await runMigrations(connect, MIGRATIONS.filter((m) => m.version <= "0036_adopt_krizaka_modules"), { lockKey: MIGRATION_LOCK_KEY });
      expect(applied).toEqual(["0036_adopt_krizaka_modules"]);
      expect((await columns()).filter((c) => !before.includes(c) && !c.startsWith("public.krizaka_module_versions."))).toEqual([]);
      expect(before.some((c) => c.startsWith("public.krizaka_module_versions."))).toBe(false);
      await assertModules(async (text, params) => (await pool.query(text, params)).rows as never, ADOPTED.filter((m) => m.schema.module !== "auth_sessions"));

      // 0037 (yomizaka#259): the trail moves into `audit.entry`, every row, none lost, the view keeps the old name.
      const [{ id: person }] = (await pool.query("INSERT INTO accounts (email) VALUES ('p@yomizaka.test') RETURNING id")).rows;
      await pool.query(
        `INSERT INTO audit_log (at, actor_id, actor_label, action, target_id, detail, ip) VALUES
           ('2026-10-01T10:00:00Z', $1::uuid, 'p@yomizaka.test', 'auth.sign_in', $1::text, '{}', '203.0.113.7'),
           ('2026-10-02T10:00:00Z', NULL, 'applicant', 'applicant-file.document-uploaded', 'abc', '{"type":"id"}', NULL),
           ('2026-10-03T10:00:00Z', gen_random_uuid(), '', 'Weird Action!', NULL, '{}', 'not an address'),
           ('2026-10-04T10:00:00Z', $1::uuid, repeat('x', 300), 'document.deleted', repeat('y', 300), '{}', '2001:db8::1')`,
        [person],
      );
      const old = (await pool.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n;
      expect(await runMigrations(connect, MIGRATIONS.filter((m) => m.version <= "0038_adopt_sessions"), { lockKey: MIGRATION_LOCK_KEY })).toEqual(["0037_audit_package", "0038_adopt_sessions"]);
      const rows = (await pool.query("SELECT actor_id, actor_label, action, target_type, target_id, host(ip) AS ip FROM audit.entry ORDER BY at")).rows;
      expect(rows).toHaveLength(old);
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n).toBe(old);
      expect(rows[0]).toMatchObject({ actor_id: person, action: "auth.sign_in", target_type: "auth", ip: "203.0.113.7" });
      expect(rows[1]).toMatchObject({ action: "applicant_file.document_uploaded", target_type: "applicant_file", target_id: "abc" });
      expect(rows[2]).toMatchObject({ actor_id: null, actor_label: "unknown", action: "weird_action_", ip: null });
      expect(rows[3]?.actor_label).toHaveLength(120);
      expect(rows[3]?.target_id).toHaveLength(200);
      // the old name still reads and, for a rolled-back code, still writes
      await pool.query("INSERT INTO audit_log (actor_id, actor_label, action, ip) VALUES ($1, 'p', 'auth.sign_in', '203.0.113.9')", [person]);
      expect((await pool.query("SELECT count(*)::int AS n FROM audit.entry")).rows[0].n).toBe(old + 1);
      expect(await runMigrations(connect, MIGRATIONS, { lockKey: MIGRATION_LOCK_KEY })).toContain("0050_credits_ledger");
      await assertModules(async (text, params) => (await pool.query(text, params)).rows as never, MODULES);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
