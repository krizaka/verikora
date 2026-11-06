import {
  postgresSettings as postgres,
  type PostgresSettingsDeps,
  type SettingsService as Service,
} from "@krizaka/settings";
import type { QueryResultRow } from "pg";

import { SETTINGS, settings } from "./registry";

/** The SettingsService (ADR-0009) is `@krizaka/settings`; this binds it to Verikora's own registry. */
export type SettingsService = Service<typeof SETTINGS>;
export { SCOPES_BY_SPECIFICITY } from "./registry";
export type { Actor, AuditEntry, Context, ScopeRef } from "@krizaka/settings";
export { GLOBAL, SettingsError } from "@krizaka/settings";

type AppQuery = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

export const postgresSettings = (
  deps: Omit<PostgresSettingsDeps<typeof SETTINGS>, "query"> & { query: AppQuery },
): SettingsService => postgres(settings, { ...deps, query: (sql, params) => deps.query(sql, params) as never });
