import { type Audience } from "@verikora/core";

import { query } from "./db";

/**
 * Which side of the lease the person is on. It drives defaults and wording only — never the rules: a tenant and a landlord
 * run the same Sovkora Studios on the same rulesets (a variant, if one is ever needed, is data of the pack, not code here).
 */
export async function setPerspective(accountId: string, value: Audience): Promise<void> {
  await query("UPDATE accounts SET perspective = $2 WHERE id = $1", [accountId, value]);
}
