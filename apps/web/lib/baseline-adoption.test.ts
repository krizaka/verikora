import { describe, expect, it } from "vitest";

import { adoptBaseline, adoptionOf, BASELINE_VERSION, LAST_REPLACED_VERSION } from "./baseline-adoption";

describe("adoptionOf", () => {
  it("lets the baseline run on a database that was never migrated", () => {
    expect(adoptionOf(null)).toBe("fresh");
    expect(adoptionOf([])).toBe("fresh");
  });

  it("records the baseline on a database made by the previous release", () => {
    expect(adoptionOf(["0001_initial", "0064_storage_cloud", LAST_REPLACED_VERSION])).toBe("adopted");
  });

  it("does nothing twice", () => {
    expect(adoptionOf([LAST_REPLACED_VERSION, BASELINE_VERSION])).toBe("already-recorded");
    expect(adoptionOf([BASELINE_VERSION])).toBe("already-recorded");
  });

  it("refuses a history that stops before the baseline, and tells how to go on", () => {
    expect(() => adoptionOf(["0001_initial", "0040_screening_polling"])).toThrow(/previous release first/);
  });
});

describe("adoptBaseline", () => {
  function fake(table: string | null, versions: string[]) {
    const writes: Array<{ text: string; values?: unknown[] }> = [];
    const run = (async (text: string, values?: unknown[]) => {
      if (text.includes("to_regclass")) {
        return [{ present: table }];
      }
      if (text.startsWith("SELECT version")) {
        return versions.map((version) => ({ version }));
      }
      writes.push({ text, values });
      return [];
    }) as never;
    return { run, writes };
  }

  it("writes nothing on a database without a history table", async () => {
    const { run, writes } = fake(null, []);
    expect(await adoptBaseline(run)).toBe("fresh");
    expect(writes).toEqual([]);
  });

  it("writes exactly one history row on an existing database, and never DDL", async () => {
    const { run, writes } = fake("schema_migrations", [LAST_REPLACED_VERSION]);
    expect(await adoptBaseline(run)).toBe("adopted");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toMatch(/^INSERT INTO public\.schema_migrations/);
    expect(writes[0]?.values).toEqual([BASELINE_VERSION]);
  });
});
