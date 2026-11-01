import { assertModules, migrate as runMigrations } from "@krizaka/db";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { seedConfig } from "./config-seed";
import { MIGRATION_LOCK_KEY } from "./db";
import { MIGRATIONS } from "./migrations";
import { MODULES } from "./modules";
import { diffSnapshot, readSnapshot, type SchemaSnapshot } from "./schema-check";
import expected from "./schema-expected.json";

const url = process.env.DATABASE_URL;
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!url;

/**
 * The database rebuilds from ZERO (krizaka-internal#2044): a database of its own, the baseline, the configuration seeded from code
 * (twice: idempotent), the Krizaka modules' versions and checksums asserted as at start, and the schema equal to the recorded one.
 * A migration added without `pnpm db:rebuild --write-expected`, or a config row missing, fails here.
 */
describe.runIf(enabled)("a database built from zero", () => {
  it("has the expected schema, the modules the code needs and its configuration", async () => {
    const name = `rebuild_${Date.now()}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: target.toString(), max: 2 });
    const connect = async () => {
      const client = await pool.connect();
      return {
        query: (text: string, values?: unknown[]) => client.query(text, values),
        release: () => client.release(),
      };
    };
    const run = async (text: string, values?: unknown[]) => (await pool.query(text, values)).rows as never;
    try {
      expect(await runMigrations(connect, MIGRATIONS, { lockKey: MIGRATION_LOCK_KEY })).toEqual(["0001_baseline"]);
      await seedConfig(run);
      await seedConfig(run);
      await assertModules(run, MODULES);
      expect(diffSnapshot(expected as SchemaSnapshot, await readSnapshot(run))).toEqual([]);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
