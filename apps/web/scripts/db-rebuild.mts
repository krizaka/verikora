// pnpm db:rebuild — DROP every schema of the database in DATABASE_URL, migrate from zero, seed the configuration from code,
// verify the schema (krizaka-internal#2044). No production yet, dev data is demo: the demo cast is seeded after, by
// `node scripts/demo-seed/cli.mjs --cast` (or `--cast` here, locally). Flags: --yes (required for a non-local host),
// --cast (run the cast seed after), --write-expected (rewrite lib/schema-expected.json from the fresh build).
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import { seedConfig } from "../lib/config-seed";
import { migrate, pool, query } from "../lib/db";
import { diffSnapshot, readSnapshot, type SchemaSnapshot } from "../lib/schema-check";

/** A refusal whose text is written in this file, safe to print. */
class RebuildRefusal extends Error {}

const EXPECTED = new URL("lib/schema-expected.json", `file://${process.cwd()}/`);
const flag = (name: string) => process.argv.includes(`--${name}`);
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.APP_ENVIRONMENT === "production") {
    throw new RebuildRefusal("db:rebuild never runs against production");
  }
  if (!LOCAL.has(url.hostname) && !flag("yes")) {
    throw new RebuildRefusal(`${url.hostname}/${url.pathname.slice(1)} is not local: pass --yes to rebuild it`);
  }
  console.log(LOCAL.has(url.hostname) ? "db:rebuild: local database" : "db:rebuild: remote database (--yes)");
  const schemas = await query<{ nspname: string }>(
    String.raw`SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND nspname NOT LIKE 'pg\_%'`,
  );
  for (const { nspname } of schemas) {
    await query(`DROP SCHEMA "${nspname}" CASCADE`);
  }
  await query("DROP SCHEMA public CASCADE");
  await query("CREATE SCHEMA public");
  const applied = await migrate();
  console.log(`migrated: ${applied.join(", ")}`);
  await seedConfig(query);
  const actual = await readSnapshot(query);
  if (flag("write-expected")) {
    await writeFile(EXPECTED, `${JSON.stringify(actual, null, 2)}\n`);
    console.log("lib/schema-expected.json written");
  } else {
    const problems = diffSnapshot(JSON.parse(await readFile(EXPECTED, "utf8")) as SchemaSnapshot, actual);
    if (problems.length) {
      throw new RebuildRefusal(`schema check failed:\n  ${problems.join("\n  ")}`);
    }
  }
  console.log(`schema check: ${Object.keys(actual.tables).length} tables, configuration present`);
  await pool().end();
  if (flag("cast")) {
    const run = spawnSync(process.execPath, ["../../scripts/demo-seed/cli.mjs", "--cast", "--check"], {
      stdio: "inherit",
      env: process.env,
    });
    if (run.status !== 0) {
      throw new RebuildRefusal("the cast seed failed");
    }
  }
  process.exit(0);
}

try {
  await main();
} catch (error) {
  // Only our own refusals carry a message written here; any other error (driver, network) may hold a connection string.
  console.error(error instanceof RebuildRefusal ? error.message.slice(0, 2000) : "db:rebuild failed (details withheld)");
  process.exit(1);
}
