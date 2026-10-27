import { adoptMigration, emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations";
import { ADOPTED, EMITTED, MODULES } from "./modules";

describe("the adopted Krizaka modules", () => {
  const adoption = { sql: MIGRATIONS.filter((m) => ["0036_adopt_krizaka_modules", "0038_adopt_sessions"].includes(m.version)).map((m) => m.sql).join("\n") };

  it("are adopted by migrations 0036 and 0038 with the text `adoptMigration` prints today (markers only, no DDL)", () => {
    expect(MIGRATIONS.some((m) => m.version === "0038_adopt_sessions")).toBe(true);
    for (const { schema, context } of ADOPTED) {
      expect(adoption.sql, schema.module).toContain(adoptMigration(schema, 1, context).trim());
    }
    expect(adoption.sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS public\.krizaka_module_versions)|ALTER TABLE|DROP /);
  });

  it("emitted by their own migration are the text `emitMigration` prints today", () => {
    const EMITTED_BY: Record<string, string> = { audit: "0037_audit_package", credits: "0050_credits_ledger" };
    for (const { schema, context } of EMITTED) {
      const migration = MIGRATIONS.find((m) => m.version === EMITTED_BY[schema.module]);
      expect(migration, schema.module).toBeDefined();
      expect(migration!.sql, schema.module).toContain(emitMigration(schema, 1, context).trim());
    }
  });

  it("list a module after the modules it requires", () => {
    const seen = new Set<string>();
    for (const { schema } of MODULES) {
      for (const required of schema.requires) expect(seen.has(required), `${schema.module} requires ${required}`).toBe(true);
      seen.add(schema.module);
    }
  });
});
