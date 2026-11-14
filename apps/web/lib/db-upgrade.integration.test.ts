import { assertModules, migrate as runMigrations } from "@krizaka/db";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { BASELINE_VERSION, LAST_REPLACED_VERSION } from "./baseline-adoption";
import { seedConfig } from "./config-seed";
import { migrate, MIGRATION_LOCK_KEY } from "./db";
import { MIGRATIONS } from "./migrations";
import { MODULES } from "./modules";
import { diffSnapshot, readSnapshot, type SchemaSnapshot } from "./schema-check";
import expected from "./schema-expected.json";

const url = process.env.DATABASE_URL;
const enabled = process.env.DATABASE_IT === "1" && !!url;

// The history the previous release left in `schema_migrations` (the 65 migrations the baseline replaced).
const PREVIOUS_RELEASE_HISTORY = ["0001_initial", "0002_showcase", "0064_storage_cloud", LAST_REPLACED_VERSION];

async function withDatabase(prefix: string, work: (pool: pg.Pool) => Promise<void>): Promise<void> {
  const name = `${prefix}_${Date.now()}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  const target = new URL(url!);
  target.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
  try {
    await work(pool);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
}

/**
 * The UPGRADE path (the dev deploy of 1e884a1 failed with `schema "audit" already exists`): a database already at the baseline,
 * with the previous release's history, must start, and start again, without replaying the baseline, without losing a row and
 * without a change of schema. The from-zero test cannot see this.
 */
describe.runIf(enabled)("a database made by the previous release", () => {
  it("is adopted by the baseline, twice, keeping its data", () =>
    withDatabase("upgrade", async (pool) => {
      const run = async (text: string, values?: unknown[]) => (await pool.query(text, values)).rows as never;
      // The previous release's database: the baseline's schema and nothing after it, its own history, an edited configuration row.
      const connect = async () => {
        const client = await pool.connect();
        return {
          query: (text: string, values?: unknown[]) => client.query(text, values),
          release: () => client.release(),
        };
      };
      const baseline = MIGRATIONS.filter((m) => m.version === BASELINE_VERSION);
      expect(await runMigrations(connect, baseline, { lockKey: MIGRATION_LOCK_KEY })).toEqual([BASELINE_VERSION]);
      await seedConfig(run);
      await pool.query("DELETE FROM public.schema_migrations");
      await pool.query("INSERT INTO public.schema_migrations (version) SELECT unnest($1::text[])", [
        PREVIOUS_RELEASE_HISTORY,
      ]);
      await pool.query("UPDATE public.retention_policies SET days = 99 WHERE id = 'thirty-days'");

      // The upgrade adopts the baseline without replaying it, then applies what came after it, once.
      const later = MIGRATIONS.map((m) => m.version).filter((v) => v !== BASELINE_VERSION);
      expect(await migrate(pool)).toEqual(later);
      expect(await migrate(pool)).toEqual([]);

      const versions = (await run("SELECT version FROM public.schema_migrations")) as Array<{ version: string }>;
      expect(versions.map((v) => v.version)).toContain(MIGRATIONS[0]?.version);
      const edited = (await run("SELECT days FROM public.retention_policies WHERE id = 'thirty-days'")) as Array<{
        days: number;
      }>;
      expect(edited[0]?.days).toBe(99);
      await assertModules(run, MODULES);
      expect(diffSnapshot(expected as SchemaSnapshot, await readSnapshot(run))).toEqual([]);
    }));

  it("refuses, without dropping anything, a history older than the baseline", () =>
    withDatabase("upgrade_old", async (pool) => {
      await pool.query(
        "CREATE TABLE public.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      await pool.query("INSERT INTO public.schema_migrations (version) VALUES ('0001_initial')");
      await expect(migrate(pool)).rejects.toThrow(/previous release first/);
      expect((await pool.query("SELECT version FROM public.schema_migrations")).rows).toHaveLength(1);
    }));
});
