import { beforeAll, describe, expect, it } from "vitest";

import { applyPaymentEvent, entitlementOf, recordCheckout, refundFailedAudit, releaseAudit, reserveAudit } from "./billing";
import { migrate, query, transaction } from "./db";

/** The entitlements against a real PostgreSQL (skipped without YOMIZAKA_DB_IT=1 and DATABASE_URL, like db.integration.test.ts). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
/** The facts every paid event carries; a test sets the ones it is about. */
const FACTS = { checkoutRef: null, paymentRef: null, invoiceRef: null, amountTotal: null, amountDiscount: 0, currency: null, metadata: {} } as const;
const caps = (perMonth = 100, perDay = 0, freeFirst = true) => () => ({ perMonth, perDay, freeFirst });

describe.runIf(enabled)("billing", () => {
  beforeAll(async () => {
    await migrate();
  });
  const account = async (selfServe = true) => {
    const [a] = await query<{ id: string }>("INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), $2) RETURNING id", [`b-${Math.random().toString(36).slice(2)}@yomizaka.test`, selfServe ? NOW : null]);
    return a!.id;
  };
  it("an operator-created account is exempt", async () => {
    expect(await reserveAudit(query, await account(false), NOW, caps())).toBe("exempt");
  });
  it("the first audit is free, the second hits the paywall, a paid credit opens one more", async () => {
    const id = await account();
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402, body: { code: "PAYWALL" } });
    expect(await applyPaymentEvent(transaction, { id: `evt-${id}`, type: "payment_paid", kind: "audit", accountId: id, customerId: `cus-${id}`, ...FACTS })).toBe("applied");
    expect(await reserveAudit(query, id, NOW, caps())).toBe("credit");
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
  });
  it("a payment notification is idempotent: the same event credits once", async () => {
    const id = await account();
    await reserveAudit(query, id, NOW, caps());
    const event = { id: `evt-dup-${id}`, type: "payment_paid", kind: "audit", accountId: id, customerId: null, ...FACTS } as const;
    expect(await applyPaymentEvent(transaction, event)).toBe("applied");
    expect(await applyPaymentEvent(transaction, event)).toBe("duplicate");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(1);
  });
  it("a handler that fails leaves no trace: the event id is not recorded, the credits are unchanged, and the retry applies it once (yomizaka#257)", async () => {
    const taken = await account();
    const id = await account();
    await query("UPDATE accounts SET payment_customer_id = $2 WHERE id = $1", [taken, `cus-shared-${taken}`]);
    // the processor's customer is already another account's (UNIQUE): the handler throws after the event id was written
    const event = { id: `evt-fail-${id}`, type: "payment_paid", kind: "audit", accountId: id, customerId: `cus-shared-${taken}`, ...FACTS } as const;
    await expect(applyPaymentEvent(transaction, event)).rejects.toThrow();
    expect(await query("SELECT 1 FROM payment_events WHERE id = $1", [event.id])).toHaveLength(0);
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
    // the retry, once the conflict is gone, applies the very same event; a third delivery is a duplicate
    await query("UPDATE accounts SET payment_customer_id = NULL WHERE id = $1", [taken]);
    expect(await applyPaymentEvent(transaction, event)).toBe("applied");
    expect(await applyPaymentEvent(transaction, event)).toBe("duplicate");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(1);
  });
  it("an event whose handler answers « ignored » (an unknown kind) credits nothing and is still recorded as seen", async () => {
    const id = await account();
    const outcome = await applyPaymentEvent(transaction, { id: `evt-kind-${id}`, type: "payment_paid", kind: "mystery", accountId: id, customerId: null, ...FACTS });
    expect(outcome).toBe("ignored");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
  });
  it("the free audit is given back when the run cannot start", async () => {
    const id = await account();
    const via = await reserveAudit(query, id, NOW, caps());
    await releaseAudit(query, id, via);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
  });
  it("two simultaneous requests cannot spend the same free audit", async () => {
    const id = await account();
    const results = await Promise.allSettled([reserveAudit(query, id, NOW, caps()), reserveAudit(query, id, NOW, caps())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("Pro: unlimited under the cap, then FAIR_USE; cancelled, back to the paywall", async () => {
    const id = await account();
    await reserveAudit(query, id, NOW, caps());
    await applyPaymentEvent(transaction, { id: `evt-s1-${id}`, type: "subscription_started", accountId: id, customerId: `cus-${id}`, subscriptionId: `sub-${id}`, ...FACTS });
    await applyPaymentEvent(transaction, { id: `evt-s2-${id}`, type: "subscription_changed", accountId: id, customerId: `cus-${id}`, subscriptionId: `sub-${id}`, status: "active", active: true, periodEnd: Math.floor(NOW.getTime() / 1000) + 86_400 * 30 });
    expect((await entitlementOf(query, id, NOW)).pro).toBe(true);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("pro");
    const [doc] = await query<{ id: string }>("INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id", [id, `h-${id}`]);
    await query("INSERT INTO analyses (document_id, studio, status) VALUES ($1, 'compliance-check', 'succeeded')", [doc!.id]);
    await expect(reserveAudit(query, id, NOW, caps(1))).rejects.toMatchObject({ status: 429, body: { code: "FAIR_USE" } });
    await applyPaymentEvent(transaction, { id: `evt-s3-${id}`, type: "subscription_changed", accountId: id, customerId: `cus-${id}`, subscriptionId: `sub-${id}`, status: "canceled", active: false, periodEnd: null });
    expect((await entitlementOf(query, id, NOW)).pro).toBe(false);
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
  });
  it("a run that failed gives the free audit back, once", async () => {
    const id = await account();
    const via = await reserveAudit(query, id, NOW, caps());
    const [doc] = await query<{ id: string }>("INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id", [id, `r-${id}`]);
    const [a] = await query<{ id: string }>("INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'document-authenticity', 'failed', $2) RETURNING id", [doc!.id, via]);
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
    expect(await refundFailedAudit(query, a!.id)).toBe(true);
    expect(await refundFailedAudit(query, a!.id)).toBe(false); // once
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
  });

  it("a failed run gives back the pot it drew from: the free audit stays the free audit, the paid credit the paid credit (yomizaka#261)", async () => {
    const id = await account();
    await applyPaymentEvent(transaction, { id: `evt-two-${id}`, type: "payment_paid", kind: "audit", accountId: id, customerId: null, ...FACTS });
    const first = await reserveAudit(query, id, NOW, caps());
    const second = await reserveAudit(query, id, NOW, caps());
    expect([first, second]).toEqual(["free", "credit"]);
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402, body: { code: "PAYWALL" } });
    const [doc] = await query<{ id: string }>("INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id", [id, `two-${id}`]);
    const failed = async (via: string) => (await query<{ id: string }>("INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'document-authenticity', 'failed', $2) RETURNING id", [doc!.id, via]))[0]!.id;
    const [a1, a2] = [await failed("free"), await failed("credit")];
    expect(await refundFailedAudit(query, a1)).toBe(true);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("free");
    await expect(reserveAudit(query, id, NOW, caps())).rejects.toMatchObject({ status: 402 });
    expect(await refundFailedAudit(query, a2)).toBe(true);
    expect(await refundFailedAudit(query, a2)).toBe(false);
    expect(await reserveAudit(query, id, NOW, caps())).toBe("credit");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
  });
  it("the entitlement reads the ledger: paid credits left, and the free audit given and gone", async () => {
    const id = await account();
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ credits: 0, freeAuditUsed: false });
    await applyPaymentEvent(transaction, { id: `evt-led-${id}`, type: "payment_paid", kind: "audit", accountId: id, customerId: null, ...FACTS });
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ credits: 1, freeAuditUsed: false });
    await reserveAudit(query, id, NOW, caps());
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ credits: 1, freeAuditUsed: true });
  });
  it("the daily cap of a plan refuses past its number (0 = no cap), whatever the plan", async () => {
    const id = await account();
    const [doc] = await query<{ id: string }>("INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id", [id, `d-${id}`]);
    await query("INSERT INTO analyses (document_id, studio, status) VALUES ($1, 'compliance-check', 'succeeded')", [doc!.id]);
    await expect(reserveAudit(query, id, new Date(), caps(100, 1))).rejects.toMatchObject({ status: 429, body: { code: "DAILY_LIMIT" } });
    expect(await reserveAudit(query, id, new Date(), caps(100, 0))).toBe("free");
  });

  it("the free first audit can be switched off: the first audit then needs a credit", async () => {
    const id = await account();
    await expect(reserveAudit(query, id, NOW, caps(100, 0, false))).rejects.toMatchObject({ status: 402, body: { code: "PAYWALL" } });
    expect(await reserveAudit(query, id, NOW, caps(100, 0, true))).toBe("free");
  });
  it("a subscription keeps the catalogue version it was sold at (recorded at checkout, kept when it starts) — ADR-009", async () => {
    const id = await account();
    await recordCheckout(query, id, { key: "yomizaka.firm", versionId: "seed:yomizaka.firm" });
    await applyPaymentEvent(transaction, { id: `evt-sub-${id}`, type: "subscription_started", accountId: id, customerId: `cus-sub-${id}`, subscriptionId: `sub-${id}`, ...FACTS });
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ planKey: "yomizaka.firm", priceVersionId: "seed:yomizaka.firm" });
    await recordCheckout(query, id, { key: "yomizaka.agency", versionId: "7" });
    await applyPaymentEvent(transaction, { id: `evt-chg-${id}`, type: "subscription_changed", accountId: id, customerId: `cus-sub-${id}`, subscriptionId: `sub-${id}`, status: "active", active: true, periodEnd: null });
    expect(await entitlementOf(query, id, NOW)).toMatchObject({ planKey: "yomizaka.firm", priceVersionId: "seed:yomizaka.firm" });
  });
});
