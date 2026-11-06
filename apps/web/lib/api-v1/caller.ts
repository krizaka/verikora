import type { Clock } from "@krizaka/api-keys";
import type { Audience } from "@verikora/core";

import { requireApiKey } from "../api-access";
import { query } from "../db";
import { refuse } from "../http";
import { assertOpen } from "../settings/guards";

/** Who calls the API: the key's owner, as the checks need them, and the key (for the audit trail). */
export interface ApiCaller {
  account: { id: string; email: string; role: "USER" | "ADMIN"; perspective: Audience | null };
  keyId: string;
}

/**
 * The caller of a `/api/v1` route (verikora#202): a key with the scope (`requireApiKey`: switch, plan, rate limit), then its
 * owner — refused like a session would be (maintenance) — so a key can do what its owner can, never more.
 */
export async function apiCaller(req: Request, scope: string, clock: Clock): Promise<ApiCaller> {
  const { ownerId, keyId } = await requireApiKey(req, scope, clock);
  const [account] = await query<ApiCaller["account"]>(
    "SELECT id, email, role, perspective FROM accounts WHERE id = $1",
    [ownerId],
  );
  if (!account) throw refuse(401, "API_KEY_INVALID", "API key refused: API_KEY_INVALID");
  await assertOpen(account);
  return { account, keyId };
}
