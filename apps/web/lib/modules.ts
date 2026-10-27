import { apiKeysSchema } from "@krizaka/api-keys";
import { auditSchema } from "@krizaka/audit";
import { accountsSchema, sessionsSchema } from "@krizaka/auth";
import { creditsSchema } from "@krizaka/credits";
import type { ComposedModule } from "@krizaka/db";
import { workspaceSchema } from "@krizaka/organize";
import { pricesSchema, settingsSchema } from "@krizaka/settings";
import { webhooksSchema } from "@krizaka/webhooks";

import { WORKSPACE } from "./workspace/decl";

/**
 * The Krizaka modules whose tables this database holds, with the product table each one points at. Their SQL ran before
 * `@krizaka/db` (0016, 0021, 0023, 0029, 0033, 0034): migration 0036 adopts them (the sessions table, 0001, by 0038) (`ADOPTED`; `EMITTED` are written by `emitMigration`) (markers only, no DDL), and `assertModules`
 * refuses to start on a database that lacks a version the code needs (`instrumentation.ts`). `lib/modules.test.ts` holds the
 * migration to this list.
 */
export const ADOPTED: readonly ComposedModule[] = [
  { schema: settingsSchema, context: { tables: {} } },
  { schema: pricesSchema, context: { tables: {} } },
  { schema: accountsSchema(), context: { tables: { accounts: "accounts" } } },
  { schema: sessionsSchema, context: { tables: { accounts: "accounts" } } },
  { schema: apiKeysSchema, context: { tables: { owner: "accounts" } } },
  { schema: webhooksSchema, context: { tables: { owner: "accounts" } } },
  { schema: workspaceSchema(WORKSPACE), context: { tables: {} } },
];

/** The modules whose tables this product created through `emitMigration` (committed in its own sequence): `audit` (0037, yomizaka#259), `credits` (0050, yomizaka#261). */
export const EMITTED: readonly ComposedModule[] = [
  { schema: auditSchema, context: { tables: { owner: "accounts" } } },
  { schema: creditsSchema, context: { tables: { owner: "accounts" } } },
];

export const MODULES: readonly ComposedModule[] = [...ADOPTED, ...EMITTED];
