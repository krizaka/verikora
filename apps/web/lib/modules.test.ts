import { signupInvitationsSchema } from "@krizaka/auth";
import { emitMigration } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations";
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

  it("commit the sign-up invitations exactly as @krizaka/auth emits them (a changed v1 in the package fails here, never silently)", () => {
    const committed = MIGRATIONS.find((m) => m.version === "0004_signup_invitations")?.sql;
    const emitted = emitMigration(signupInvitationsSchema, 1, { tables: {} });
    expect(committed).toBe(emitted.trimEnd());
  });
});
