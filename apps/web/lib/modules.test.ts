import { describe, expect, it } from "vitest";

import { MODULES } from "./modules";

describe("the Krizaka modules", () => {
  it("list a module after the modules it requires", () => {
    const seen = new Set<string>();
    for (const { schema } of MODULES) {
      for (const required of schema.requires)
        expect(seen.has(required), `${schema.module} requires ${required}`).toBe(true);
      seen.add(schema.module);
    }
  });
});
