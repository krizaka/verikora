import type { IdempotencyStore, SuppressionList, SuppressionReason } from "@krizaka/email";

import { query } from "../db";

/**
 * The mail memory in the app's own database (yomizaka#48): the addresses a provider told us never to mail again (a hard bounce, a
 * complaint, an unsubscribe) and the intentions already mailed (one key per link). The package asks for two small ports; this is
 * where they live, so a restart or a second instance forgets neither.
 */
export const pgSuppression: SuppressionList = {
  async has(email) {
    const [row] = await query("SELECT 1 FROM mail_suppressions WHERE email = $1", [email.trim().toLowerCase()]);
    return !!row;
  },
  async add(email, reason: SuppressionReason) {
    await query("INSERT INTO mail_suppressions (email, reason) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING", [email.trim().toLowerCase(), reason]);
  },
};

export const pgIdempotency: IdempotencyStore = {
  async claim(key) {
    const rows = await query("INSERT INTO mail_intentions (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key", [key]);
    return rows.length > 0;
  },
  async release(key) {
    await query("DELETE FROM mail_intentions WHERE key = $1", [key]);
  },
};
