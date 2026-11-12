import type { Territory } from "@verikora/core";

import { query } from "./db";

/** The account's territory: which jurisdiction's checks the check page lists (data, never a branch on the locale). */
export async function setTerritory(accountId: string, value: Territory): Promise<void> {
  await query("UPDATE accounts SET territory = $2 WHERE id = $1", [accountId, value]);
}
