import { addMinutes } from "@krizaka/time";

import { audit } from "../audit";
import { query } from "../db";
import { logError } from "../log";
import { bandOf, itemOf, namesOf, type ScreeningResult } from "../screening";
import { CHECK_OUTCOME, CHECK_STATE, type CheckPurpose, type CheckResult, stateOf } from "./model";
import { adapterFor, type CheckProvider } from "./providers";

/*
 * Collecting the answers of the checks a provider accepted but did not answer (PENDING), by polling (yomizaka#134; a signed
 * webhook comes later, yomizaka#426). Idempotent: a check is settled once (`WHERE state = 'pending'`), so a second poll, a
 * replay or two instances at once change nothing twice. Only a closed outcome, the opaque reference and the run id are kept.
 */
export interface Due {
  id: string;
  screening_id: string;
  check_type: string;
  provider_ref: string | null;
  run_id: string;
  polls: number;
  landlord_id: string;
  tenant_name: string;
  purpose: CheckPurpose;
  region: string;
  adapter: string;
  poll_minutes: number;
  poll_max: number;
}

export type Next = { settle: CheckResult } | { later: Date } | { giveUp: true };

/** Pure: what follows a poll. An answer settles; a pending one is asked again later, until the provider's tries are spent, then given up (never kept pending for good). */
export function decide(result: CheckResult, polls: number, pollMax: number, pollMinutes: number, now: Date): Next {
  if (result.outcome !== CHECK_OUTCOME.PENDING) return { settle: result };
  return polls + 1 >= pollMax ? { giveUp: true } : { later: addMinutes(now, pollMinutes) };
}

const GAVE_UP: CheckResult = { outcome: CHECK_OUTCOME.TIMEOUT, refusal: null, category: "NONE", providerRef: null };

export function dueChecks(now: Date, limit: number): Promise<Due[]> {
  return query<Due>(
    `SELECT c.id, c.screening_id, c.check_type, c.provider_ref, c.run_id, c.polls, s.landlord_id, s.tenant_name, t.purpose, t.region, p.adapter, p.poll_minutes, p.poll_max
       FROM screening_checks c
       JOIN screenings s ON s.id = c.screening_id AND s.result IS NOT NULL
       JOIN check_type t ON t.key = c.check_type
       JOIN screening_provider p ON p.id = t.provider_id AND p.enabled
      WHERE c.state = 'pending' AND c.next_poll_at <= $1
      ORDER BY c.next_poll_at LIMIT $2`,
    [now, limit],
  );
}

/** The summary the tenant sees is rebuilt from the checks' lines: same band rule as at consent. */
export async function refreshResult(screeningId: string, now: Date): Promise<void> {
  const rows = await query<{ check_type: string; outcome: string; refusal: string | null }>("SELECT check_type, outcome, refusal FROM screening_checks WHERE screening_id = $1 ORDER BY check_type", [screeningId]);
  const [current] = await query<{ result: ScreeningResult | null }>("SELECT result FROM screenings WHERE id = $1", [screeningId]);
  if (!current?.result || rows.length === 0) return;
  const order = new Map(current.result.items.map((i, n) => [i.key, n]));
  const items = rows.map((r) => itemOf(r.check_type, r as never)).sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  const result: ScreeningResult = { ...current.result, band: bandOf(items), items, generatedAt: now.toISOString() };
  await query("UPDATE screenings SET result = $2 WHERE id = $1 AND result IS NOT NULL", [screeningId, JSON.stringify(result)]);
}

/** Polls one check. Returns true when it was settled by this call. */
export async function collectOne(due: Due, provider: CheckProvider, now: Date): Promise<boolean> {
  let polled: CheckResult;
  try {
    const call = { userId: due.landlord_id, runId: due.run_id, subject: { subjectId: due.screening_id, ...namesOf(due.tenant_name) }, region: due.region };
    polled = await provider.collect(due.purpose, call, due.provider_ref ?? "");
  } catch (error) {
    // A transient failure of the poll is not an answer: the check stays pending and is asked again.
    logError("screening: a poll failed", error);
    polled = { outcome: CHECK_OUTCOME.PENDING, refusal: null, category: "NONE", providerRef: due.provider_ref };
  }
  const next = decide(polled, due.polls, due.poll_max, due.poll_minutes, now);
  if ("later" in next) {
    await query("UPDATE screening_checks SET polls = polls + 1, next_poll_at = $2 WHERE id = $1 AND state = 'pending'", [due.id, next.later]);
    return false;
  }
  const final = "settle" in next ? next.settle : GAVE_UP;
  const state = stateOf(final);
  const settled = await query<{ id: string }>(
    "UPDATE screening_checks SET state = $2, outcome = $3, refusal = $4, category = $5, provider_ref = COALESCE($6, provider_ref), polls = polls + 1, next_poll_at = NULL, answered_at = $7 WHERE id = $1 AND state = 'pending' RETURNING id",
    [due.id, state, final.outcome, final.refusal, final.category, final.providerRef, now],
  );
  if (settled.length === 0) return false;
  await refreshResult(due.screening_id, now);
  await audit({ action: "screening.check.collected", actorId: null, actorLabel: "collector", targetId: due.screening_id, detail: { checkType: due.check_type, outcome: final.outcome, state, runId: due.run_id } });
  return state !== CHECK_STATE.pending;
}

/** One look at the due checks. A check that raises never stops the others. */
export async function collectPending(now: Date, limit = 50): Promise<{ polled: number; settled: number }> {
  const due = await dueChecks(now, limit);
  let settled = 0;
  for (const d of due) {
    try {
      if (await collectOne(d, adapterFor(d.adapter), now)) settled += 1;
    } catch (error) {
      logError("screening: collecting a check failed", error);
    }
  }
  return { polled: due.length, settled };
}
