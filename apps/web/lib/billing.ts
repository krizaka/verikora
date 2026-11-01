import { dbCreditStore } from "@krizaka/credits";
import type { Query as DbQuery } from "@krizaka/db";
import { localDay } from "@krizaka/intl/date";
import { applyOnceInTransaction, type PaymentEvent, type Transaction } from "@krizaka/payments";
import type { QueryResultRow } from "pg";

import {
  addPurchased,
  ensureFreeAudit,
  FREE_AUDIT_SOURCE,
  giveBackAudit,
  nextMonth,
  spendAudit,
} from "./audit-credits";
import { confirmCoupon, refundCoupon, releaseCoupon } from "./coupons/events";
import { transaction } from "./db";
import { refuse } from "./http";
import { chargeOverage, type OverageBiller, refundOverage } from "./overage";
import type { AuditCaps } from "./settings/boundary";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * Entitlements — the domain, vendor-free (it speaks the payments port's events, never a processor's). A self-serve account
 * (one that accepted the terms at sign-up) gets free dossiers each month (`plans.free.dossiersPerMonth`, 1 by default, renewed on the 1st, no card), then pays per document (a credit) or
 * subscribes (Agencies or Law firms), up to the verifications its catalogue entry includes — the version it was sold at
 * (ADR-009, passed in by `capsOf`). Accounts created by an operator (QA, demo personas) are exempt. The stored state mirrors
 * the processor's notifications, each applied once.
 */
type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
/**
 * `dossier`: the document belongs to a dossier already billed this month (the unit is the dossier, not the check): nothing is spent again.
 * `overage`: a subscription's dossier beyond the included volume, charged at the rate the plan was sold at (ADR-0015).
 */
export type AuditVia = "exempt" | "free" | "credit" | "pro" | "dossier" | "overage";

export interface Entitlement {
  selfServe: boolean;
  freeAuditUsed: boolean;
  credits: number;
  pro: boolean;
  proUntil: string | null;
  /** The subscription was cancelled and stays active until `proUntil`: nothing renews. */
  cancelsAtPeriodEnd: boolean;
  subscriptionStatus: string | null;
  hasCustomer: boolean;
  /** The processor's customer, when there is one: what an overage is charged to. */
  customerId: string | null;
  /** The catalogue entry and version the subscription was sold at (null: none recorded — one sold before the catalogue). */
  planKey: string | null;
  priceVersionId: string | null;
}

const ROW = `SELECT (terms_accepted_at IS NOT NULL) AS self_serve, plan,
  subscription_status, current_period_end, cancel_at_period_end, (payment_customer_id IS NOT NULL) AS has_customer, payment_customer_id, subscription_price_key, subscription_price_version FROM accounts WHERE id = $1`;

export async function entitlementOf(query: Query, accountId: string, now: Date): Promise<Entitlement> {
  const [r] = await query<{
    self_serve: boolean;
    plan: string;
    subscription_status: string | null;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
    has_customer: boolean;
    payment_customer_id: string | null;
    subscription_price_key: string | null;
    subscription_price_version: string | null;
  }>(ROW, [accountId]);
  if (!r) {
    throw refuse(404, "NOT_FOUND", "No such account");
  }
  const live = r.subscription_status === "active" || r.subscription_status === "trialing";
  const pro = r.plan === "PRO" && live && (!r.current_period_end || r.current_period_end > now);
  const { credits, freeAuditUsed } = await ledgerState(query, accountId, now);
  return {
    selfServe: r.self_serve,
    freeAuditUsed,
    credits,
    pro,
    proUntil: r.current_period_end?.toISOString() ?? null,
    cancelsAtPeriodEnd: r.cancel_at_period_end,
    subscriptionStatus: r.subscription_status,
    hasCustomer: r.has_customer,
    customerId: r.payment_customer_id,
    planKey: r.subscription_price_key,
    priceVersionId: r.subscription_price_version,
  };
}

/** The calendar the ledger counts a pot's daily and monthly use in: not read here (the audit pots have no caps), so the day in UTC. */
const calendarOf = (now: Date) => {
  const day = localDay(now, "UTC");
  return { timeZone: "UTC", day, month: day.slice(0, 7) };
};

/** What the ledger says of an account: the paid credits left, and whether this month's free dossier was given and is gone (spent or lapsed). A month without a pot yet is not used: the pot is made when the first check asks. */
export async function ledgerState(
  query: Query,
  accountId: string,
  now: Date,
): Promise<{ credits: number; freeAuditUsed: boolean }> {
  const states = await dbCreditStore(query as unknown as DbQuery).grantStates(accountId, calendarOf(now));
  const live = states.filter((s) => !s.closed && (s.grant.expiresAt === null || s.grant.expiresAt > now));
  const free = states.filter((s) => s.grant.source === FREE_AUDIT_SOURCE);
  const thisMonth = free.some((s) => s.grant.expiresAt?.getTime() === nextMonth(now).getTime());
  return {
    credits: live.filter((s) => s.grant.bucket === "purchased").reduce((n, s) => n + s.remaining, 0),
    freeAuditUsed: thisMonth && !free.some((s) => live.includes(s) && s.remaining > 0),
  };
}

export type Plan = "free" | "pro";

/** The caps of an account's plan: the subscription's come from its catalogue entry, so they may be read asynchronously. */
export type CapsOf = (plan: Plan, entitlement: Entitlement) => AuditCaps | Promise<AuditCaps>;

/**
 * The dossier of a document: the application file it was sent in, or itself when it stands alone. A dossier is the unit the
 * included volume counts and the credit buys (all the documents and checks of one applicant), not each check.
 */
const DOSSIER = "COALESCE(d.screening_id, d.id)";

/** The dossiers an account started this calendar month (what the included volume counts): the home's meter reads the same number. */
export async function dossiersUsedThisMonth(query: Query, accountId: string, now: Date): Promise<number> {
  return Number((await query<{ n: string }>(COUNT_SINCE, [accountId, now, "month"]))[0]?.n ?? 0);
}

const COUNT_SINCE = `SELECT count(DISTINCT ${DOSSIER}) AS n FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 AND a.created_at >= date_trunc($3, $2::timestamptz)`;

/** The dossier of this document already has a check billed this month (a refunded one does not count): its next checks are on the house. */
async function dossierIsBilled(query: Query, documentId: string, now: Date): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM documents me JOIN documents d ON ${DOSSIER} = COALESCE(me.screening_id, me.id)
       JOIN analyses a ON a.document_id = d.id
      WHERE me.id = $1 AND a.billed_via IS NOT NULL AND a.billed_via NOT LIKE '%-refunded'
        AND a.created_at >= date_trunc('month', $2::timestamptz) LIMIT 1`,
    [documentId, now],
  );
  return rows.length > 0;
}

/**
 * Takes the right to one dossier's audit, atomically (two requests cannot spend the same free audit or credit). Throws 402 PAYWALL when
 * there is none, 429 FAIR_USE past the verifications the subscription includes and 429 DAILY_LIMIT past its daily cap. The
 * caps are the configuration's and the catalogue's (`capsOf`); the caller gives the audit back with `releaseAudit` if the run
 * could not start. Given the document, a second check of a dossier already billed this month spends nothing (`dossier`). Past the
 * included volume, a plan with an overage rate (and a processor to charge) bills the dossier (`overage`, ADR-0015) instead of holding it.
 */
export async function reserveAudit(
  query: Query,
  accountId: string,
  now: Date,
  capsOf: CapsOf,
  documentId?: string,
  biller?: OverageBiller | null,
): Promise<AuditVia> {
  const e = await entitlementOf(query, accountId, now);
  if (!e.selfServe) {
    return "exempt";
  }
  if (documentId && (await dossierIsBilled(query, documentId, now))) {
    return "dossier";
  }
  const caps = await capsOf(e.pro ? "pro" : "free", e);
  const used = async (period: "day" | "month") =>
    period === "month"
      ? dossiersUsedThisMonth(query, accountId, now)
      : Number((await query<{ n: string }>(COUNT_SINCE, [accountId, now, period]))[0]?.n ?? 0);
  if (caps.perDay > 0 && (await used("day")) >= caps.perDay) {
    throw refuse(429, "DAILY_LIMIT", "Daily limit reached", { limit: caps.perDay });
  }
  if (e.pro) {
    if ((await used("month")) < caps.perMonth) {
      return "pro";
    }
    if (caps.overageCents > 0 && biller && documentId && e.customerId) {
      return billOverage(query, biller, {
        accountId,
        customerId: e.customerId,
        documentId,
        cents: caps.overageCents,
        now,
      });
    }
    throw refuse(429, "FAIR_USE", "Monthly fair-use limit reached", { limit: caps.perMonth });
  }
  return transaction(async (tx) => {
    if (caps.freeDossiers > 0) {
      await ensureFreeAudit(tx, accountId, now, caps.freeDossiers);
    }
    return spendAudit(tx, accountId);
  });
}

/** Charges the dossier beyond the included volume (ADR-0015) and says so: the audit is then `overage`. */
async function billOverage(
  query: Query,
  biller: OverageBiller,
  sale: { accountId: string; customerId: string; documentId: string; cents: number; now: Date },
): Promise<AuditVia> {
  await chargeOverage(query, biller, { ...sale, description: `${PRODUCT_NAME} — dossier beyond the included volume` });
  return "overage";
}

/** Gives the audit back when the run could not start: the free first audit or the paid credit it spent, or the overage charged (Pro and exempt spent nothing). */
export async function releaseAudit(
  query: Query,
  accountId: string,
  via: AuditVia,
  now: Date,
  documentId?: string,
  biller?: OverageBiller | null,
): Promise<void> {
  if (via === "free" || via === "credit") {
    await transaction((tx) => giveBackAudit(tx, accountId, via));
  } else if (via === "overage" && documentId && biller) {
    await refundOverage(query, biller, documentId, now);
  }
}

/** A run that failed gives its audit back, once: the free audit or the credit it spent (Pro and exempt accounts spent nothing). The mark and the give-back commit together. */
export async function refundFailedAudit(
  query: Query,
  analysisId: string,
  now: Date,
  biller?: OverageBiller | null,
): Promise<boolean> {
  const [overage] = await query<{ document_id: string }>(
    "UPDATE analyses SET billed_via = 'overage-refunded' WHERE id = $1 AND billed_via = 'overage' RETURNING document_id",
    [analysisId],
  );
  if (overage) {
    return biller ? refundOverage(query, biller, overage.document_id, now) : false;
  }
  return transaction(async (tx) => {
    const [done] = await tx<{ billed_via: string; document_id: string }>(
      "UPDATE analyses SET billed_via = billed_via || '-refunded' WHERE id = $1 AND billed_via IN ('free', 'credit') RETURNING billed_via, document_id",
      [analysisId],
    );
    if (!done) {
      return false;
    }
    const [owner] = await tx<{ owner_id: string }>("SELECT owner_id FROM documents WHERE id = $1", [done.document_id]);
    if (!owner) {
      return false;
    }
    return giveBackAudit(tx, owner.owner_id, done.billed_via.startsWith("free") ? "free" : "credit");
  });
}

/** What a one-off payment of each kind buys, in audit credits (data: a new one-off kind is a line here; `audit` is the checkout kind sold before the catalogue). */
const CREDITS_PER_KIND: Record<string, number | undefined> = { document: 1, audit: 1 };

/** The price a checkout sells, recorded on the account before the processor's page opens: the subscription keeps it when it starts. */
export async function recordCheckout(
  query: Query,
  accountId: string,
  sold: { key: string; versionId: string },
): Promise<void> {
  await query("UPDATE accounts SET checkout_price_key = $2, checkout_price_version = $3 WHERE id = $1", [
    accountId,
    sold.key,
    sold.versionId,
  ]);
}

/** The record of applied notifications: `payments.event`, the table this product has had since migration 0009, moved into the payments module's schema by 0052. */
const EVENT_TABLE = { schema: "payments", table: "event" } as const;

/**
 * Applies a verified payment event once, in ONE transaction: the event's id is recorded and its effect written together, so a handler that
 * fails rolls the id back with it and the processor's retry applies the event (nothing is lost, nothing is counted twice). A replay changes nothing.
 */
export async function applyPaymentEvent(
  transaction: Transaction,
  event: PaymentEvent,
): Promise<"applied" | "duplicate" | "ignored"> {
  return applyOnceInTransaction(
    transaction,
    event,
    {
      payment_paid: async (e, tx) => {
        await confirmCoupon(tx, e);
        const credits = CREDITS_PER_KIND[e.kind];
        if (!credits) {
          return "ignored";
        }
        if (e.customerId) {
          await tx("UPDATE accounts SET payment_customer_id = COALESCE(payment_customer_id, $2) WHERE id = $1", [
            e.accountId,
            e.customerId,
          ]);
        }
        await addPurchased(tx, e.accountId, credits, `pay-${e.id}`);
        return undefined;
      },
      subscription_started: async (e, tx) => {
        await confirmCoupon(tx, e);
        if (e.customerId) {
          await tx("UPDATE accounts SET payment_customer_id = COALESCE(payment_customer_id, $2) WHERE id = $1", [
            e.accountId,
            e.customerId,
          ]);
        }
        await tx(
          `UPDATE accounts SET plan = 'PRO', payment_subscription_id = $2, subscription_status = COALESCE(subscription_status, 'active'),
             subscription_price_key = checkout_price_key, subscription_price_version = checkout_price_version WHERE id = $1`,
          [e.accountId, e.subscriptionId],
        );
      },
      checkout_expired: (e, tx) => releaseCoupon(tx, e),
      payment_refunded: (e, tx) => refundCoupon(tx, e),
      subscription_changed: async (e, tx) => {
        const rows = await tx(
          `UPDATE accounts SET plan = $3, subscription_status = $4, payment_subscription_id = $5, current_period_end = to_timestamp($6), cancel_at_period_end = $7,
             subscription_price_key = COALESCE(subscription_price_key, checkout_price_key), subscription_price_version = COALESCE(subscription_price_version, checkout_price_version)
             WHERE payment_customer_id = $1 OR id::text = $2 RETURNING id`,
          [
            e.customerId,
            e.accountId,
            e.active ? "PRO" : "FREE",
            e.status,
            e.subscriptionId,
            e.periodEnd,
            e.cancelAtPeriodEnd,
          ],
        );
        return rows.length ? undefined : "ignored";
      },
    },
    { table: EVENT_TABLE },
  );
}
