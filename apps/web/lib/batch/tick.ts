import type { FlowEnvironment } from "@verikora/core";
import { addMinutes, subHours } from "date-fns";

import { query, withAdvisoryLock } from "../db";
import { settingsFor } from "../settings/guards";
import { appSettings } from "../settings/instance";
import { waitsForAccount } from "./pausing";
import { advanceBatch } from "./run";

/**
 * A batch that advances without anyone looking at it (verikora#240). A property manager who sends 200 leases and closes the tab
 * still gets a finished batch: every `limits.batchTickSeconds` the server takes the unfinished batches (the oldest first,
 * younger than `limits.batchTickMaxAgeHours`, at most `limits.batchTickBatches`) and advances each with its owner's settings,
 * exactly as opening the page does. One instance does it at a time (an advisory lock); one batch failing never stops the others.
 */
// @fixed: the advisory-lock key of the tick (migrate uses 73191) — a technical identifier, not a business parameter
export const TICK_LOCK = 73192;
/** A batch waiting for the account to pay is not tried again before this many minutes. */
// @fixed: how long a batch that waits for payment is left alone — the account pays on its own time, not every few seconds
const ACCOUNT_WAIT_MINUTES = 10;

export interface TickReport {
  /** Batches advanced. */
  advanced: number;
  /** Batches that raised (logged, tried again at the next look). */
  failed: number;
  /** False when another instance held the lock. */
  ran: boolean;
}

interface Due {
  id: string;
  owner_id: string;
  perspective: "landlord" | "tenant" | "freelancer" | "client" | null;
}

/** The batches to advance now, oldest first. */
export async function dueBatches(
  now: Date,
  maxAgeHours: number,
  limit: number,
  owners?: readonly string[],
): Promise<Due[]> {
  const since = subHours(now, maxAgeHours);
  return query<Due>(
    `SELECT b.id, b.owner_id, a.perspective FROM batches b JOIN accounts a ON a.id = b.owner_id
      WHERE b.finished_at IS NULL AND b.created_at >= $1 AND (b.tick_after IS NULL OR b.tick_after <= $2) AND a.status = 'ACTIVE' AND ($4::uuid[] IS NULL OR b.owner_id = ANY($4))
      ORDER BY b.created_at LIMIT $3`,
    [since, now, limit, owners ?? null],
  );
}

/** `owners` narrows the look to some accounts (tests share a database; the server passes none). */
export async function tickBatches(
  now: Date,
  environment: FlowEnvironment,
  log: (message: string, error?: unknown) => void = () => undefined,
  owners?: readonly string[],
): Promise<TickReport> {
  const report = await withAdvisoryLock(TICK_LOCK, async (): Promise<TickReport> => {
    const global = await appSettings().snapshot();
    const due = await dueBatches(
      now,
      global["limits.batchTickMaxAgeHours"].value as number,
      global["limits.batchTickBatches"].value as number,
      owners,
    );
    let advanced = 0;
    let failed = 0;
    for (const batch of due) {
      try {
        const view = await advanceBatch({ id: batch.owner_id, perspective: batch.perspective as never }, batch.id, {
          settings: await settingsFor(batch.owner_id),
          now,
          environment,
        });
        advanced++;
        if (waitsForAccount(view.pausedBy))
          await query("UPDATE batches SET tick_after = $2 WHERE id = $1", [
            batch.id,
            addMinutes(now, ACCOUNT_WAIT_MINUTES),
          ]);
        else await query("UPDATE batches SET tick_after = NULL WHERE id = $1 AND tick_after IS NOT NULL", [batch.id]);
      } catch (error) {
        failed++;
        log(`batch ${batch.id} not advanced`, error);
      }
    }
    return { advanced, failed, ran: true };
  });
  return report ?? { advanced: 0, failed: 0, ran: false };
}
