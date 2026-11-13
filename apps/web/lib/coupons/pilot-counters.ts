import { PURPOSE } from "@krizaka/coupons";
import type { Query } from "@krizaka/db";

import { query, transaction } from "../db";
import { logError } from "../log";
import { PILOT_STAGE, type PilotCodeCounts, type PilotCounts, type PilotStage } from "./pilot-stages";

export { PILOT_STAGE, type PilotCodeCounts, type PilotCounts, type PilotStage };

/**
 * The four counters of a pilot code (krizaka-internal#3230): aggregates, one integer per code and stage — no account, no e-mail, no applicant in the count.
 * Each is raised once per account because the caller raises it at the one moment the account crosses the stage (under the account's row lock, or in the
 * payment event's own transaction, which is applied once): the first redemption of the code, the account's first file past the pilot, its first and its second payment.
 */

const STAGES = Object.values(PILOT_STAGE);

/** The code that opened the account's pilot (a use neither released nor revoked); `null` for an account without one. */
async function pilotOf(run: Query, accountId: string): Promise<{ couponId: string } | null> {
  const [row] = await run<{ coupon_id: string }>(
    `SELECT r.coupon_id FROM coupons.redemption r JOIN coupons.coupon c ON c.id = r.coupon_id
      WHERE r.account_id = $1 AND c.purpose = $2 AND r.status IN ('reserved', 'confirmed')
      ORDER BY r.created_at LIMIT 1`,
    [accountId, PURPOSE.demo],
  );
  return row ? { couponId: row.coupon_id } : null;
}

/** Raises one stage of the account's pilot code by one; an account without a pilot changes nothing. */
export async function countStage(run: Query, accountId: string, stage: PilotStage): Promise<void> {
  const pilot = await pilotOf(run, accountId);
  if (!pilot) {
    return;
  }
  await run(
    `INSERT INTO public.pilot_counter (coupon_id, stage, n) VALUES ($1, $2, 1)
       ON CONFLICT (coupon_id, stage) DO UPDATE SET n = pilot_counter.n + 1`,
    [pilot.couponId, stage],
  );
}

/**
 * A file of the account has started. It is the pilot's « first real file » when it is not a sample and no file of the account was counted before: the first one is
 * flagged (`analyses.pilot_first_file`) and counted, decided under the account's row lock, so two first files at once, or the same file recorded twice, count one.
 * A failure of the count never fails the file.
 */
export async function recordRealFile(accountId: string, analysisId: string): Promise<void> {
  try {
    await transaction(async (tx) => {
      await tx("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
      if (!(await pilotOf(tx, accountId))) {
        return;
      }
      const marked = await tx(
        `UPDATE analyses SET pilot_first_file = true
          WHERE id = $2 AND EXISTS (SELECT 1 FROM documents d WHERE d.id = analyses.document_id AND d.owner_id = $1 AND NOT d.sample)
            AND NOT EXISTS (SELECT 1 FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 AND a.pilot_first_file)
          RETURNING id`,
        [accountId, analysisId],
      );
      if (marked.length > 0) {
        await countStage(tx, accountId, PILOT_STAGE.firstRealFile);
      }
    });
  } catch (error) {
    logError("pilot: the first real file could not be counted", error);
  }
}

/** A one-off payment was applied for the account (once per event): its first and its second raise their stage. Runs in the event's transaction. */
export async function recordPayment(tx: Query, accountId: string): Promise<void> {
  const [row] = await tx<{ n: string }>(
    `SELECT count(*) AS n FROM credits."grant" WHERE account_id = $1 AND bucket = 'purchased'`,
    [accountId],
  );
  const paid = Number(row?.n ?? 0);
  if (paid === 1) {
    await countStage(tx, accountId, PILOT_STAGE.firstPayment);
  }
  if (paid === 2) {
    await countStage(tx, accountId, PILOT_STAGE.secondPayment);
  }
}

/** The counters of every pilot code, for the console (read-only): a code with no count yet shows zeros. */
export async function pilotCounters(run: Query = query): Promise<PilotCodeCounts[]> {
  const rows = await run<{ coupon_id: string; code: string; stage: PilotStage | null; n: number | null }>(
    `SELECT c.id AS coupon_id, c.code, p.stage, p.n FROM coupons.coupon c
       LEFT JOIN public.pilot_counter p ON p.coupon_id = c.id
      WHERE c.purpose = $1 ORDER BY c.code`,
    [PURPOSE.demo],
  );
  const byCode = new Map<string, PilotCodeCounts>();
  for (const r of rows) {
    const entry = byCode.get(r.coupon_id) ?? {
      couponId: r.coupon_id,
      code: r.code,
      counts: Object.fromEntries(STAGES.map((s) => [s, 0])) as PilotCounts,
    };
    if (r.stage) {
      entry.counts[r.stage] = r.n ?? 0;
    }
    byCode.set(r.coupon_id, entry);
  }
  return [...byCode.values()];
}
