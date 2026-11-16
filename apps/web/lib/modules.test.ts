import { signupInvitationsSchema } from "@krizaka/auth";
import { checksumOf, emitMigration } from "@krizaka/db";
import { workspaceSchema } from "@krizaka/organize";
import { storageSchema } from "@krizaka/storage/provider-admin";
import { describe, expect, it } from "vitest";

import { MIGRATIONS } from "./migrations";
import { MODULES } from "./modules";
import { WORKSPACE } from "./workspace/decl";
import { TAG_LIST_DDL, WORKSPACE_CHECKSUM } from "./workspace/migration";

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

  it("commit the storage tenant keys exactly as @krizaka/storage emits them (v2)", () => {
    const committed = MIGRATIONS.find((m) => m.version === "0009_storage_tenant_keys")?.sql;
    const emitted = emitMigration(storageSchema, 2, { tables: {} });
    expect(committed).toBe(emitted.trimEnd());
  });

  it("commit the tables of the collection and folder kinds exactly as @krizaka/organize emits them, and the module's checksum (0010)", () => {
    const schema = workspaceSchema(WORKSPACE);
    const emitted = emitMigration(schema, 1, { tables: {} });
    expect(emitted).toContain(TAG_LIST_DDL);
    expect(checksumOf(schema, 1, { tables: {} })).toBe(WORKSPACE_CHECKSUM);
    expect(MIGRATIONS.find((m) => m.version === "0010_one_tag_list")?.sql).toContain(TAG_LIST_DDL);
  });
});
