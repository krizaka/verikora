import { randomUUID } from "node:crypto";

import { CreditsError } from "@krizaka/credits";
import type { PaymentEvent } from "@krizaka/payments";
import { beforeAll, describe, expect, it } from "vitest";

import { ledger } from "../audit-credits";
import { applyPaymentEvent, entitlementOf } from "../billing";
import { migrate, query, transaction } from "../db";
import { appSettings } from "../settings/instance";
import { GLOBAL } from "../settings/service";
import { giveBack, reserve } from "./checkout";
import { coupons } from "./instance";

/** The money path of coupons against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL): reserve, pay once, release, refund, credit codes, erasure. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date();
const ADMIN = { id: null, label: "admin@verikora.test" };
const FACTS = {
  checkoutRef: null,
  paymentRef: null,
  invoiceRef: null,
  amountTotal: null,
  amountDiscount: 0,
  currency: null,
  metadata: {},
} as const;
// @fixed: a day, to start a coupon's window in the past
const DAY_MS = 86_400_000;
const START = new Date(NOW.getTime() - DAY_MS);

describe.runIf(enabled)("coupons", () => {
  beforeAll(async () => {
    await migrate();
    await appSettings().set(ADMIN, GLOBAL, "coupons.enabled", true, NOW);
  });
  const account = async () => {
    const [a] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), now()) RETURNING id",
      [`c-${randomUUID()}@verikora.test`],
    );
    return a!.id;
  };
  const code = () => `T${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const ip = () =>
    `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const discount = (over: Record<string, unknown> = {}) =>
    transaction((tx) =>
      coupons.admin.create(tx, ADMIN, {
        code: code(),
        kind: "discount",
        purpose: "promo",
        startsAt: START,
        percentOffBp: 2000,
        duration: "once",
        ...over,
      }),
    );
  const credit = (over: Record<string, unknown> = {}) =>
    transaction((tx) =>
      coupons.admin.create(tx, ADMIN, {
        code: code(),
        kind: "credit",
        purpose: "demo",
        startsAt: START,
        credits: 20,
        capPerDay: 2,
        creditsValidDays: 30,
        onExhausted: "stop",
        ...over,
      }),
    );
  const reserveFor = (accountId: string, c: { code: string }) =>
    reserve({ code: c.code, accountId, plan: "document", amountMinor: 6500, currency: "cad", ip: ip() });
  const redemption = async (id: string) =>
    (
      await query<{
        status: string;
        over_limit: boolean;
        amount_refunded_minor: string;
        use_restored: boolean;
        payment_ref: string | null;
        account_id: string | null;
      }>(
        "SELECT status, over_limit, amount_refunded_minor, use_restored, payment_ref, account_id FROM coupons.redemption WHERE id = $1",
        [id],
      )
    )[0]!;
  const paid = (accountId: string, redemptionId: string, extra: Record<string, unknown> = {}): PaymentEvent =>
    ({
      id: `evt-${randomUUID()}`,
      type: "payment_paid",
      kind: "document",
      accountId,
      customerId: null,
      ...FACTS,
      checkoutRef: `cs_${redemptionId}`,
      paymentRef: `pi_${redemptionId}`,
      amountTotal: 5200,
      amountDiscount: 1300,
      currency: "cad",
      metadata: { redemption_id: redemptionId },
      ...extra,
    }) as PaymentEvent;
  const redeemCredit = (c: { code: string }, accountId: string) =>
    transaction((tx) =>
      coupons.redeemCredit(tx, { code: c.code, accountId, idempotencyKey: `redeem-${randomUUID()}`, ip: ip() }),
    );
  const spend = (accountId: string) =>
    transaction((tx) =>
      ledger.consume(tx, { accountId, amount: 1, reason: "audit", idempotencyKey: `spend-${randomUUID()}` }),
    );

  it("a paid checkout confirms the use once, whatever the number of deliveries, and still credits the document", async () => {
    const c = await discount({ maxRedemptions: 5 });
    const id = await account();
    const r = await reserveFor(id, c);
    expect(r.applied.discount).toMatchObject({ couponId: c.id, percentOffBp: 2000, duration: "once" });
    expect((await redemption(r.applied.redemptionId)).status).toBe("reserved");
    const event = paid(id, r.applied.redemptionId);
    expect(await applyPaymentEvent(transaction, event)).toBe("applied");
    expect(await applyPaymentEvent(transaction, event)).toBe("duplicate");
    // a second event for the same payment (another event id) cannot confirm it twice
    expect(await applyPaymentEvent(transaction, { ...event, id: `evt-${randomUUID()}` })).toBe("applied");
    expect((await redemption(r.applied.redemptionId)).status).toBe("confirmed");
    expect(
      await query("SELECT 1 FROM coupons.redemption WHERE coupon_id = $1 AND status = 'confirmed'", [c.id]),
    ).toHaveLength(1);
    expect((await entitlementOf(query, id, NOW)).credits).toBe(2);
  });

  it("a handler that fails leaves the use reserved and the event unrecorded; the retry confirms it (money and coupon commit together)", async () => {
    const c = await discount();
    const taken = await account();
    const id = await account();
    await query("UPDATE accounts SET payment_customer_id = $2 WHERE id = $1", [taken, `cus-c-${taken}`]);
    const r = await reserveFor(id, c);
    const event = paid(id, r.applied.redemptionId, { customerId: `cus-c-${taken}` });
    await expect(applyPaymentEvent(transaction, event)).rejects.toThrow();
    expect((await redemption(r.applied.redemptionId)).status).toBe("reserved");
    expect(await query("SELECT 1 FROM payments.event WHERE id = $1", [event.id])).toHaveLength(0);
    await query("UPDATE accounts SET payment_customer_id = NULL WHERE id = $1", [taken]);
    expect(await applyPaymentEvent(transaction, event)).toBe("applied");
    expect((await redemption(r.applied.redemptionId)).status).toBe("confirmed");
  });

  it("an expired checkout gives the use back, and a payment that arrives later is honoured and flagged over limit", async () => {
    const c = await discount({ maxRedemptions: 1 });
    const first = await account();
    const second = await account();
    const r = await reserveFor(first, c);
    await expect(reserveFor(second, c)).rejects.toMatchObject({ body: { code: "COUPON_EXHAUSTED" } });
    const expired = {
      id: `evt-${randomUUID()}`,
      type: "checkout_expired",
      checkoutRef: `cs_${r.applied.redemptionId}`,
      accountId: first,
      metadata: { redemption_id: r.applied.redemptionId },
    } as never;
    expect(await applyPaymentEvent(transaction, expired)).toBe("applied");
    expect((await redemption(r.applied.redemptionId)).status).toBe("released");
    const other = await reserveFor(second, c);
    expect((await redemption(other.applied.redemptionId)).status).toBe("reserved");
    // the first customer still paid the discounted price in good faith
    await applyPaymentEvent(transaction, paid(first, r.applied.redemptionId));
    expect(await redemption(r.applied.redemptionId)).toMatchObject({ status: "confirmed", over_limit: true });
  });

  it("a session that could not be made gives the use back at once", async () => {
    const c = await discount({ maxRedemptions: 1 });
    const r = await reserveFor(await account(), c);
    await giveBack(r);
    expect((await redemption(r.applied.redemptionId)).status).toBe("released");
    expect((await reserveFor(await account(), c)).applied.redemptionId).toBeTruthy();
  });

  it("two accounts after the last use: one wins, the other is refused", async () => {
    const c = await discount({ maxRedemptions: 1 });
    const [a, b] = [await account(), await account()];
    const results = await Promise.allSettled([reserveFor(a, c), reserveFor(b, c)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ body: { code: "COUPON_EXHAUSTED" } });
  });

  it("the launch offer: -50 % for 3 months on the monthly plans, once per account, refused for another plan or when over (#548)", async () => {
    const launch = await discount({
      percentOffBp: 5000,
      duration: "repeating",
      durationMonths: 3,
      plans: ["agency", "firm"],
      maxPerAccount: 1,
    });
    const monthly = (accountId: string, plan: string) =>
      reserve({ code: launch.code.toLowerCase(), accountId, plan, amountMinor: 4900, currency: "cad", ip: ip() });
    const id = await account();
    // valid: the processor is told 50 % for 3 months, so the 4th invoice is the regular price
    const ok = await monthly(id, "agency");
    expect(ok.applied.discount).toMatchObject({
      couponId: launch.id,
      percentOffBp: 5000,
      duration: "repeating",
      durationMonths: 3,
    });
    // already used by this account
    await expect(monthly(id, "firm")).rejects.toMatchObject({ body: { code: "COUPON_ACCOUNT_LIMIT" } });
    // wrong plan: the single document is not in the offer
    await expect(
      reserve({
        code: launch.code,
        accountId: await account(),
        plan: "document",
        amountMinor: 499,
        currency: "cad",
        ip: ip(),
      }),
    ).rejects.toMatchObject({ body: { code: "COUPON_NOT_FOR_PLAN" } });
    // expired: the window has closed
    const over = await discount({
      percentOffBp: 5000,
      duration: "repeating",
      durationMonths: 3,
      startsAt: new Date(NOW.getTime() - 3 * DAY_MS),
      endsAt: new Date(NOW.getTime() - DAY_MS),
    });
    await expect(
      reserve({
        code: over.code,
        accountId: await account(),
        plan: "agency",
        amountMinor: 4900,
        currency: "cad",
        ip: ip(),
      }),
    ).rejects.toMatchObject({ body: { code: "COUPON_EXPIRED" } });
  });

  it("a refund adds up and never gives the use back unless the admin allowed it", async () => {
    const c = await discount({ maxRedemptions: 1 });
    const id = await account();
    const r = await reserveFor(id, c);
    await applyPaymentEvent(transaction, paid(id, r.applied.redemptionId));
    const refund = (amount: number) =>
      applyPaymentEvent(transaction, {
        id: `evt-${randomUUID()}`,
        type: "payment_refunded",
        paymentRef: `pi_${r.applied.redemptionId}`,
        invoiceRef: null,
        chargeRef: "ch_x",
        amountRefunded: amount,
        amountCharged: 5200,
        currency: "cad",
        metadata: {},
      } as never);
    await refund(1000);
    expect(await redemption(r.applied.redemptionId)).toMatchObject({
      status: "confirmed",
      amount_refunded_minor: "1000",
      use_restored: false,
    });
    await refund(5200);
    expect(await redemption(r.applied.redemptionId)).toMatchObject({
      amount_refunded_minor: "5200",
      use_restored: false,
    });
    await expect(reserveFor(await account(), c)).rejects.toMatchObject({ body: { code: "COUPON_EXHAUSTED" } });
  });

  it("a credit code grants capped, expiring credits to the ledger, once per account, and the cap holds", async () => {
    const c = await credit();
    const id = await account();
    const first = await redeemCredit(c, id);
    expect(first.credits).toBe(20);
    await expect(redeemCredit(c, id)).rejects.toMatchObject({ code: "COUPON_ACCOUNT_LIMIT" });
    const [grant] = await query<{ cap_per_day: string; expires_at: Date; on_exhausted: string; bucket: string }>(
      `SELECT cap_per_day, expires_at, on_exhausted, bucket FROM credits."grant" WHERE id = $1`,
      [first.grantId],
    );
    expect(grant).toMatchObject({ cap_per_day: "2", on_exhausted: "stop", bucket: "granted" });
    expect(grant!.expires_at.getTime()).toBeGreaterThan(NOW.getTime());
    await spend(id);
    await spend(id);
    await expect(spend(id)).rejects.toBeInstanceOf(CreditsError);
  });

  it("revoking a credit redemption writes off what is left; a credit without an expiry is refused", async () => {
    await expect(credit({ creditsValidDays: null })).rejects.toBeTruthy();
    const c = await credit({ capPerDay: null });
    const id = await account();
    const done = await redeemCredit(c, id);
    await transaction((tx) => coupons.revoke(tx, ADMIN, done.redemptionId));
    expect((await redemption(done.redemptionId)).status).toBe("revoked");
    await expect(spend(id)).rejects.toBeInstanceOf(CreditsError);
  });

  it("a free discount cannot be stored: 100 % and a fixed amount that runs forever are refused", async () => {
    await expect(discount({ percentOffBp: 10000 })).rejects.toBeTruthy();
    await expect(
      discount({ percentOffBp: null, amountOffMinor: 500, currency: "cad", duration: "forever" }),
    ).rejects.toBeTruthy();
  });

  it("erasing the account leaves the redemption (the use and the revenue stay) under no one", async () => {
    const c = await discount({ maxRedemptions: 1 });
    const id = await account();
    const r = await reserveFor(id, c);
    await applyPaymentEvent(transaction, paid(id, r.applied.redemptionId));
    await query("DELETE FROM accounts WHERE id = $1", [id]);
    expect(await redemption(r.applied.redemptionId)).toMatchObject({ status: "confirmed", account_id: null });
    await expect(reserveFor(await account(), c)).rejects.toMatchObject({ body: { code: "COUPON_EXHAUSTED" } });
  });

  it("the sweeper releases the reservations nobody paid for once their deadline passed", async () => {
    const c = await discount({ maxRedemptions: 1 });
    const r = await reserveFor(await account(), c);
    await query("UPDATE coupons.redemption SET reserved_until = now() - interval '1 minute' WHERE id = $1", [
      r.applied.redemptionId,
    ]);
    const { sweepCoupons } = await import("./sweep");
    expect(await sweepCoupons()).toBeGreaterThanOrEqual(1);
    expect((await redemption(r.applied.redemptionId)).status).toBe("released");
  });

  it("the codes are off until the owner turns them on", async () => {
    await appSettings().set(ADMIN, GLOBAL, "coupons.enabled", false, NOW);
    try {
      const c = await discount();
      await expect(reserveFor(await account(), c)).rejects.toMatchObject({ body: { code: "COUPON_DISABLED" } });
    } finally {
      await appSettings().set(ADMIN, GLOBAL, "coupons.enabled", true, NOW);
    }
  });
});
