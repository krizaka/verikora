import { randomUUID } from "node:crypto";

import { createCredits, CREDITS_CODE, CreditsError, dbCreditStore, ENTRY_TYPE, ON_EXHAUSTED } from "@krizaka/credits";
import { readCreditsSettings } from "@krizaka/credits/settings";
import type { Query } from "@krizaka/db";
import { addHours } from "@krizaka/time";

import { systemClock } from "../app/system-clock";
import { refuse } from "./http";
import { appSettings } from "./settings/instance";

/**
 * The credits of audits, on `@krizaka/credits`'s ledger (yomizaka#261). A paid credit is a PURCHASED pot; the free first audit is a granted
 * pot of one (source `free-audit`) that, once spent, moves on to purchased credits (`fallback_paid`). The pots are never edited: what is left
 * is the sum of their lines, and a spent audit is one operation (`consume.audit-<id>`) that a refund gives back, once, to the pots it drew from.
 */
export const ledger = createCredits({
  clock: systemClock,
  settings: () => readCreditsSettings((key) => appSettings().get(key) as Promise<string | number | undefined>),
});

/** Where the free first audit comes from: the `source` of its pot. */
export const FREE_AUDIT_SOURCE = "free-audit";
const REASON = "audit";
const HISTORY_WINDOW = 100;
// @fixed: hours in a day, the unit the time package adds in
const HOURS_PER_DAY = 24;
// @fixed: the stem of a consume key; the reader of a refund strips it to name the operation the package keyed
const CONSUME_PREFIX = "consume.";

export type PotKind = "free" | "credit";

/** The pot of the free first audit, made once per account (the key is the account): a replay answers the same pot. */
export async function ensureFreeAudit(tx: Query, accountId: string): Promise<string> {
  const validDays = (await appSettings().get("audit.freeValidDays")) as number;
  const { grantId } = await ledger.grant(tx, {
    accountId,
    amount: 1,
    expiresAt: addHours(systemClock.now(), validDays * HOURS_PER_DAY),
    onExhausted: ON_EXHAUSTED.fallbackPaid,
    source: FREE_AUDIT_SOURCE,
    idempotencyKey: `free-audit-${accountId}`,
  });
  return grantId;
}

/** A purchased credit per payment (the key is the payment's event id: a replay adds nothing). */
export async function addPurchased(tx: Query, accountId: string, amount: number, paymentKey: string): Promise<void> {
  await ledger.purchase(tx, { accountId, amount, source: `purchase:${paymentKey}`, idempotencyKey: paymentKey });
}

/** Spends one audit. The package's refusals are the product's: no credit left is the 402 PAYWALL. */
export async function spendAudit(tx: Query, accountId: string): Promise<PotKind> {
  try {
    const { draws } = await ledger.consume(tx, { accountId, amount: 1, reason: REASON, idempotencyKey: `audit-${randomUUID()}` });
    return (await kindOf(tx, draws[0]?.grantId));
  } catch (error) {
    if (error instanceof CreditsError && (error.code === CREDITS_CODE.paywall || error.code === CREDITS_CODE.exhausted)) throw refuse(402, "PAYWALL", "Payment required");
    throw error;
  }
}

/** The kind of a pot: the free first audit's, or a paid credit's. */
async function kindOf(tx: Query, grantId: string | null | undefined): Promise<PotKind> {
  const pot = grantId ? await dbCreditStore(tx).grantById(grantId) : null;
  return pot?.source === FREE_AUDIT_SOURCE ? "free" : "credit";
}

/**
 * Gives back the account's latest audit that drew from `kind` and was not given back yet. Credits are fungible, but the free audit and a
 * paid credit are not the same pot: a failed run gives back the one it spent. True when something was given back.
 */
export async function giveBackAudit(tx: Query, accountId: string, kind: PotKind): Promise<boolean> {
  const lines = await ledger.history(tx, accountId, { limit: HISTORY_WINDOW });
  const refunded = new Set(lines.filter((l) => l.type === ENTRY_TYPE.refund).map((l) => l.reverses));
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.type !== ENTRY_TYPE.debit || line.reason !== REASON || !line.grantId || refunded.has(line.operation) || seen.has(line.operation)) continue;
    seen.add(line.operation);
    if ((await kindOf(tx, line.grantId)) !== kind) continue;
    await ledger.refund(tx, { accountId, consumed: line.operation.slice(CONSUME_PREFIX.length), reason: "the audit could not run" });
    return true;
  }
  return false;
}
