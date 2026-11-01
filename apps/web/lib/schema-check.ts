import type { Query } from "@krizaka/db";

/**
 * The schema check of a rebuilt database (krizaka-internal#2044): every table and column the application needs
 * (`schema-expected.json`, written by `pnpm db:rebuild --write-expected` from a fresh build) and every configuration key the
 * code seeds. A column added by a migration without the snapshot, or a config row missing, fails — locally, in CI and on dev.
 */
export interface SchemaSnapshot {
  /** "schema.table" → its columns, sorted. */
  tables: Record<string, string[]>;
  /** Configuration table → its keys, sorted. */
  config: Record<string, string[]>;
}

// @fixed: the tables whose rows are configuration seeded from code (lib/config-seed.ts), with the column naming the row
export const CONFIG_KEYS: Readonly<Record<string, string>> = {
  "public.screening_provider": "id",
  "public.check_type": "key",
  "public.retention_policies": "id",
  "public.document_types": "id",
  "public.compliance_gate": "blocker",
};

// @fixed: the runner's own bookkeeping, not part of the application's schema
const IGNORED = new Set(["public.schema_migrations"]);

export async function readSnapshot(query: Query): Promise<SchemaSnapshot> {
  const columns = await query<{ t: string; c: string }>(
    `SELECT table_schema || '.' || table_name AS t, column_name AS c
       FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2`,
  );
  const tables: Record<string, string[]> = {};
  for (const { t, c } of columns) {
    if (IGNORED.has(t)) {
      continue;
    }
    tables[t] = [...(tables[t] ?? []), c];
  }
  const config: Record<string, string[]> = {};
  for (const [table, key] of Object.entries(CONFIG_KEYS)) {
    const rows = await query<{ k: string }>(`SELECT ${key}::text AS k FROM ${table} ORDER BY 1`);
    config[table] = rows.map((r) => r.k);
  }
  return { tables, config };
}

function diffTable(table: string, want: string[], have: string[] | undefined): string[] {
  if (!have) {
    return [`missing table ${table}`];
  }
  return [
    ...want.filter((c) => !have.includes(c)).map((c) => `missing column ${table}.${c}`),
    ...have.filter((c) => !want.includes(c)).map((c) => `unexpected column ${table}.${c}`),
  ];
}

/** What the expected snapshot needs and the database lacks (or has in excess): one line each; empty = the schema is right. */
export function diffSnapshot(expected: SchemaSnapshot, actual: SchemaSnapshot): string[] {
  return [
    ...Object.entries(expected.tables).flatMap(([table, cols]) => diffTable(table, cols, actual.tables[table])),
    ...Object.keys(actual.tables)
      .filter((table) => !expected.tables[table])
      .map((table) => `unexpected table ${table}`),
    ...Object.entries(expected.config).flatMap(([table, keys]) =>
      keys.filter((k) => !actual.config[table]?.includes(k)).map((k) => `missing config ${table} ${k}`),
    ),
  ];
}
