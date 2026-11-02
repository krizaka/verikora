import type { Query } from "@krizaka/db";

/**
 * Databases made before the single baseline (krizaka-internal#2044, 2026-11-01) carry the history of the 65 migrations it replaced.
 * Their schema IS the baseline's: the baseline must be recorded as applied, never run (it would fail on `CREATE SCHEMA audit`,
 * and a rebuild is the only thing allowed to drop anything).
 */
export const BASELINE_VERSION = "0001_baseline";

/** The last migration of the history the baseline replaced: a database that has it is at the baseline. */
export const LAST_REPLACED_VERSION = "0065_overage_charges";

export type BaselineAdoption = "adopted" | "already-recorded" | "fresh";

/** The decision, from the versions recorded in the history table (`null`: no history table, a database never migrated). */
export function adoptionOf(recorded: readonly string[] | null): BaselineAdoption {
  if (recorded === null || recorded.length === 0) {
    return "fresh";
  }
  if (recorded.includes(BASELINE_VERSION)) {
    return "already-recorded";
  }
  if (recorded.includes(LAST_REPLACED_VERSION)) {
    return "adopted";
  }
  throw new Error(
    `The database history stops before ${LAST_REPLACED_VERSION}: deploy the previous release first so it is complete, or rebuild this development database (pnpm db:rebuild). The start-up never drops anything.`,
  );
}

/**
 * Records the baseline in the history of a database that is already at it. Call it under the migration lock, before the runner.
 * Writes one row, never anything else; does nothing on a fresh database (the baseline runs) or an adopted one.
 */
export async function adoptBaseline(run: Query): Promise<BaselineAdoption> {
  const table = await run<{ present: string | null }>("SELECT to_regclass('public.schema_migrations') AS present");
  if (table[0]?.present == null) {
    return "fresh";
  }
  const rows = await run<{ version: string }>("SELECT version FROM public.schema_migrations");
  const decision = adoptionOf(rows.map((row) => row.version));
  if (decision === "adopted") {
    await run("INSERT INTO public.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [BASELINE_VERSION]);
  }
  return decision;
}
