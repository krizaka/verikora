import type { Query } from "@krizaka/db";

import { ensureFreeAudit, ledger, spendAudit } from "./audit-credits";
import { transaction } from "./db";

/** For tests: puts an account's audits where the ledger keeps them — the free first audit given and spent, then `credits` paid ones. */
export async function seedAudits(accountId: string, { credits = 0, freeUsed = false }: { credits?: number; freeUsed?: boolean }): Promise<void> {
  await transaction(async (tx: Query) => {
    if (freeUsed) {
      await ensureFreeAudit(tx, accountId);
      await spendAudit(tx, accountId);
    }
    if (credits > 0) await ledger.purchase(tx, { accountId, amount: credits, source: "purchase:test", idempotencyKey: `seed-${accountId}` });
  });
}
