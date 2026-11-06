import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyPaymentEvent,
  entitlementOf,
  recordCheckout,
  refundFailedAudit,
  releaseAudit,
  reserveAudit,
} from "./billing";
import { migrate, query, transaction } from "./db";

/** The entitlements against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL, like db.integration.test.ts). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
/** The facts every paid event carries; a test sets the ones it is about. */
const FACTS = {
  checkoutRef: null,
  paymentRef: null,
  invoiceRef: null,
  amountTotal: null,
  amountDiscount: 0,
  currency: null,
  metadata: {},
} as const;
const caps =
  (perMonth = 100, perDay = 0, freeDossiers = 1) =>
  () => ({ perMonth, perDay, freeDossiers, overageCents: 0 });

const startPro = async (id: string, tag: string) => {
  await applyPaymentEvent(transaction, {
    id: `evt-${tag}1-${id}`,
    type: "subscription_started",
    accountId: id,
    customerId: `cus-${id}`,
    subscriptionId: `sub-${id}`,
    ...FACTS,
  });
  await applyPaymentEvent(transaction, {
    id: `evt-${tag}2-${id}`,
    type: "subscription_changed",
    accountId: id,
    customerId: `cus-${id}`,
    subscriptionId: `sub-${id}`,
    status: "active",
    active: true,
    cancelAtPeriodEnd: false,
    periodEnd: Math.floor(NOW.getTime() / 1000) + 86_400 * 30,
  });
};

describe.runIf(enabled)("billing", () => {
  // The credits ledger reads the wall clock (systemClock) for a grant that "lapses in the future"; the tests pass NOW (22 Oct). Pinned,
  // they no longer break on the 1st of a month, when the real date overtakes the month's free pot (merge group of #695, 2026-11-01).
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  beforeAll(async () => {
    await migrate();
  });
  const account = async (selfServe = true) => {
    const [a] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), $2) RETURNING id",
      [`b-${Math.random().toString(36).slice(2)}@verikora.test`, selfServe ? NOW : null],
    );
    return a!.id;
  };
  it("an operator-created account is exempt", async () => {
    expect(await reserveAudit(query, await account(false), NOW, caps())).toBe("exempt");
  });
  it("the first audit is free, the second hits the paywall, a paid credit opens one more", async () => {
    const id = await account();
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({
      status: 402,
      body: { code: "PAYWALL" },
    });
    expect(
      await applyPaymentEvent(transaction, {
        id: `evt-${id}`,
        type: "payment_paid",
        kind: "audit",
        accountId: id,
        customerId: `cus-${id}`,
        ...FACTS,
      }),
    ).toBe("applied");
    expect(await reserveAudit(query, id, NOW, caps())).toBe("credit");
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
  });
  it("a payment notification is idempotent: the same event credits once", async () => {
    const id = await account();
    await reserveAudit(query, id, NOW, caps());
    const event = {
      id: `evt-dup-${id}`,
      type: "payment_paid",
      kind: "audit",
      accountId: id,
      customerId: null,
      ...FACTS,
    } as const;
    expect(await applyPaymentEvent(transaction, event)).toBe("applied");
    expect(await applyPaymentEvent(transaction, event)).toBe("duplicate");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(1);
  });
  it("a handler that fails leaves no trace: the event id is not recorded, the credits are unchanged, and the retry applies it once (verikora#257)", async () => {
    const taken = await account();
    const id = await account();
    await query("UPDATE accounts SET payment_customer_id = $2 WHERE id = $1", [taken, `cus-shared-${taken}`]);
    // the processor's customer is already another account's (UNIQUE): the handler throws after the event id was written
    const event = {
      id: `evt-fail-${id}`,
      type: "payment_paid",
      kind: "audit",
      accountId: id,
      customerId: `cus-shared-${taken}`,
      ...FACTS,
    } as const;
    await expect(applyPaymentEvent(transaction, event)).rejects.toThrow();
    expect(await query("SELECT 1 FROM payments.event WHERE id = $1", [event.id])).toHaveLength(0);
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
    // the retry, once the conflict is gone, applies the very same event; a third delivery is a duplicate
    await query("UPDATE accounts SET payment_customer_id = NULL WHERE id = $1", [taken]);
    expect(await applyPaymentEvent(transaction, event)).toBe("applied");
    expect(await applyPaymentEvent(transaction, event)).toBe("duplicate");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(1);
  });
  it("an event whose handler answers « ignored » (an unknown kind) credits nothing and is still recorded as seen", async () => {
    const id = await account();
    const outcome = await applyPaymentEvent(transaction, {
      id: `evt-kind-${id}`,
      type: "payment_paid",
      kind: "mystery",
      accountId: id,
      customerId: null,
      ...FACTS,
    });
    expect(outcome).toBe("ignored");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
  });
  it("the free audit is given back when the run cannot start", async () => {
    const id = await account();
    const via = await reserveAudit(query, id, NOW, caps());
    await releaseAudit(query, id, via, NOW);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
  });
  it("two simultaneous requests cannot spend the same free audit", async () => {
    const id = await account();
    const results = await Promise.allSettled([
      reserveAudit(query, id, NOW, caps()),
      reserveAudit(query, id, NOW, caps()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("Pro: unlimited under the cap, then FAIR_USE; cancelled, back to the paywall", async () => {
    const id = await account();
    await reserveAudit(query, id, NOW, caps());
    await startPro(id, "s");
    expect((await entitlementOf(query, id, NOW)).pro).toBe(true);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("pro");
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
      [id, `h-${id}`],
    );
    await query("INSERT INTO analyses (document_id, studio, status) VALUES ($1, 'compliance-check', 'succeeded')", [
      doc!.id,
    ]);
    await expect(reserveAudit(query, id, NOW, caps(1))).rejects.toMatchObject({
      status: 429,
      body: { code: "FAIR_USE" },
    });
    await applyPaymentEvent(transaction, {
      id: `evt-s3-${id}`,
      type: "subscription_changed",
      accountId: id,
      customerId: `cus-${id}`,
      subscriptionId: `sub-${id}`,
      status: "canceled",
      active: false,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    expect((await entitlementOf(query, id, NOW)).pro).toBe(false);
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
  });
  it("Pro past the included volume: a plan with a rate charges the dossier once and refunds a check that did not run (ADR-0015)", async () => {
    const id = await account();
    await startPro(id, "o");
    const document = async (n: number) =>
      (
        await query<{ id: string }>(
          "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
          [id, `o${n}-${id}`],
        )
      )[0]!.id;
    const first = await document(1);
    const second = await document(2);
    await query(
      "INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'compliance-check', 'succeeded', 'pro')",
      [first],
    );
    const calls: string[] = [];
    const biller = {
      charge: async ({ key, amountMinor }: { key: string; amountMinor: number }) => {
        calls.push(`charge ${amountMinor}`);
        return { ref: `in_${key}` };
      },
      refund: async (ref: string) => {
        calls.push(`refund ${ref}`);
      },
      isDeclined: () => false,
    };
    const rated = () => ({ perMonth: 1, perDay: 0, freeDossiers: 1, overageCents: 300 });
    // no processor: the account still waits
    await expect(reserveAudit(query, id, NOW, rated, second, null)).rejects.toMatchObject({
      body: { code: "FAIR_USE" },
    });
    expect(await reserveAudit(query, id, NOW, rated, second, biller)).toBe("overage");
    expect(await reserveAudit(query, id, NOW, rated, second, biller)).toBe("overage");
    expect(calls).toEqual(["charge 300"]);
    await releaseAudit(query, id, "overage", NOW, second, biller);
    expect(calls.filter((c) => c.startsWith("refund"))).toHaveLength(1);
    await releaseAudit(query, id, "overage", NOW, second, biller);
    expect(calls.filter((c) => c.startsWith("refund"))).toHaveLength(1);
  });
  it("a subscription cancelled in the portal stays Pro until the period ends, and says so (verikora#139)", async () => {
    const id = await account();
    const change = (n: number, cancelAtPeriodEnd: boolean) =>
      applyPaymentEvent(transaction, {
        id: `evt-c${n}-${id}`,
        type: "subscription_changed",
        accountId: id,
        customerId: `cus-${id}`,
        subscriptionId: `sub-${id}`,
        status: "active",
        active: true,
        cancelAtPeriodEnd,
        periodEnd: Math.floor(NOW.getTime() / 1000) + 86_400 * 10,
      });
    await applyPaymentEvent(transaction, {
      id: `evt-c0-${id}`,
      type: "subscription_started",
      accountId: id,
      customerId: `cus-${id}`,
      subscriptionId: `sub-${id}`,
      ...FACTS,
    });
    await change(1, false);
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ pro: true, cancelsAtPeriodEnd: false });
    await change(2, true);
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ pro: true, cancelsAtPeriodEnd: true });
    await change(3, false);
    expect((await entitlementOf(query, id, NOW)).cancelsAtPeriodEnd).toBe(false);
  });
  it("a run that failed gives the free audit back, once", async () => {
    const id = await account();
    const via = await reserveAudit(query, id, NOW, caps());
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
      [id, `r-${id}`],
    );
    const [a] = await query<{ id: string }>(
      "INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'document-authenticity', 'failed', $2) RETURNING id",
      [doc!.id, via],
    );
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
    expect(await refundFailedAudit(query, a!.id, NOW)).toBe(true);
    expect(await refundFailedAudit(query, a!.id, NOW)).toBe(false); // once
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
  });

  it("a failed run gives back the pot it drew from: the free audit stays the free audit, the paid credit the paid credit (verikora#261)", async () => {
    const id = await account();
    await applyPaymentEvent(transaction, {
      id: `evt-two-${id}`,
      type: "payment_paid",
      kind: "audit",
      accountId: id,
      customerId: null,
      ...FACTS,
    });
    const first = await reserveAudit(query, id, NOW, caps());
    const second = await reserveAudit(query, id, NOW, caps());
    expect([first, second]).toEqual(["free", "credit"]);
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({
      status: 402,
      body: { code: "PAYWALL" },
    });
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
      [id, `two-${id}`],
    );
    const failed = async (via: string) =>
      (
        await query<{ id: string }>(
          "INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'document-authenticity', 'failed', $2) RETURNING id",
          [doc!.id, via],
        )
      )[0]!.id;
    const [a1, a2] = [await failed("free"), await failed("credit")];
    expect(await refundFailedAudit(query, a1, NOW)).toBe(true);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
    expect(await refundFailedAudit(query, a2, NOW)).toBe(true);
    expect(await refundFailedAudit(query, a2, NOW)).toBe(false);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("credit");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
  });
  it("the entitlement reads the ledger: paid credits left, and the free audit given and gone", async () => {
    const id = await account();
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ credits: 0, freeAuditUsed: false });
    await applyPaymentEvent(transaction, {
      id: `evt-led-${id}`,
      type: "payment_paid",
      kind: "audit",
      accountId: id,
      customerId: null,
      ...FACTS,
    });
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ credits: 1, freeAuditUsed: false });
    await reserveAudit(query, id, NOW, caps());
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ credits: 1, freeAuditUsed: true });
  });
  it("the daily cap of a plan refuses past its number (0 = no cap), whatever the plan", async () => {
    const id = await account();
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
      [id, `d-${id}`],
    );
    await query("INSERT INTO analyses (document_id, studio, status) VALUES ($1, 'compliance-check', 'succeeded')", [
      doc!.id,
    ]);
    await expect(reserveAudit(query, id, new Date(), caps(100, 1))).rejects.toMatchObject({
      status: 429,
      body: { code: "DAILY_LIMIT" },
    });
    expect(await reserveAudit(query, id, new Date(), caps(100, 0))).toBe("free");
  });

  it("the free first audit can be switched off: the first audit then needs a credit", async () => {
    const id = await account();
    await expect(reserveAudit(query, id, NOW, caps(100, 0, 0))).rejects.toMatchObject({
      status: 402,
      body: { code: "PAYWALL" },
    });
    expect(await reserveAudit(query, id, NOW, caps(100, 0, 1))).toBe("free");
  });
  it("a subscription keeps the catalogue version it was sold at (recorded at checkout, kept when it starts) — ADR-009", async () => {
    const id = await account();
    await recordCheckout(query, id, { key: "verikora.firm", versionId: "seed:verikora.firm" });
    await applyPaymentEvent(transaction, {
      id: `evt-sub-${id}`,
      type: "subscription_started",
      accountId: id,
      customerId: `cus-sub-${id}`,
      subscriptionId: `sub-${id}`,
      ...FACTS,
    });
    expect(await entitlementOf(query, id, NOW)).toMatchObject({
      planKey: "verikora.firm",
      priceVersionId: "seed:verikora.firm",
    });
    await recordCheckout(query, id, { key: "verikora.agency", versionId: "7" });
    await applyPaymentEvent(transaction, {
      id: `evt-chg-${id}`,
      type: "subscription_changed",
      accountId: id,
      customerId: `cus-sub-${id}`,
      subscriptionId: `sub-${id}`,
      status: "active",
      active: true,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    expect(await entitlementOf(query, id, NOW)).toMatchObject({
      planKey: "verikora.firm",
      priceVersionId: "seed:verikora.firm",
    });
  });
});
