import { migrate as runMigrations } from "@krizaka/db";
import { endPool } from "@krizaka/db/testing";
import { createIncidentRegister } from "@krizaka/privacy";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { MIGRATION_LOCK_KEY } from "./db";
import { MIGRATIONS } from "./migrations";

/** Migration 0055 creates the incident register; each scope sees only its own entries, and an entry stays until its retention ends (skipped without DATABASE_IT=1 and a database). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("0055_privacy_incident_register", () => {
  it("keeps one register per scope on the real database", async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const name = `b53_incident_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    const connect = async () => {
      const client = await pool.connect();
      return {
        query: (text: string, values?: unknown[]) => client.query(text, values),
        release: () => client.release(),
      };
    };
    const run = async (text: string, values?: unknown[]) => (await pool.query(text, values)).rows as never;
    try {
      await runMigrations(connect, MIGRATIONS, { lockKey: MIGRATION_LOCK_KEY });
      const register = createIncidentRegister({ clock: { now: () => new Date() } });
      const actor = { id: null, label: "admin@verikora.test" };
      const mine = await register.open(
        run,
        { scope: "verikora", kind: "loss", description: "A laptop was lost.", information: ["lease"] },
        actor,
      );
      await register.open(
        run,
        { scope: "folioviv", kind: "access", description: "Another tenant.", information: ["invoice"] },
        actor,
      );
      expect((await register.list(run, "verikora")).map((i) => i.id)).toEqual([mine.id]);
      expect(await register.get(run, "folioviv", mine.id)).toBeNull();
      await expect(register.close(run, "folioviv", mine.id, actor)).rejects.toMatchObject({ code: "INCIDENT_UNKNOWN" });
      await expect(pool.query("DELETE FROM privacy.incident WHERE id = $1", [mine.id])).rejects.toThrow(/retention/);
    } finally {
      await endPool(pool);
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
