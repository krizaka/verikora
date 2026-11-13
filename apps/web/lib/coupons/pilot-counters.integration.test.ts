import { randomUUID } from "node:crypto";

import type { PaymentEvent } from "@krizaka/payments";
import { subHours } from "@krizaka/time";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPaymentEvent, reserveAudit } from "../billing";
import { migrate, query, transaction } from "../db";
import { HttpError } from "../http";
import { appSettings } from "../settings/instance";
import { GLOBAL } from "../settings/service";
import { coupons } from "./instance";
import { redeemCreditCode } from "./pilot";
import { PILOT_STAGE, pilotCounters, recordRealFile } from "./pilot-counters";

/** The four counters of a pilot code against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL): krizaka-internal#3230. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date();
const ADMIN = { id: null, label: "admin@verikora.test" };
const CAPS = () => ({ freeDossiers: 0, perDay: 0, perMonth: 0, overageCents: 0 });
const ZERO = { activated: 0, first_real_file: 0, first_payment: 0, second_payment: 0 };

describe.runIf(enabled)("the four counters of a pilot code", () => {
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
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.2`;
  const pilot = (credits = 1) =>
    transaction((tx) =>
      coupons.admin.create(tx, ADMIN, {
        code: `Q${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
        kind: "credit",
        purpose: "demo",
        startsAt: subHours(NOW, 24),
        credits,
        creditsValidDays: 30,
        capPerDay: 3,
        maxRedemptions: 50,
        onExhausted: "fallback_paid",
      }),
    );
  const activate = (code: string, accountId: string, key = `t-${randomUUID()}`) =>
    redeemCreditCode({ code, accountId, idempotencyKey: key, ip: ip() });
  const counts = async (couponId: string) =>
    (await pilotCounters(query)).find((c) => c.couponId === couponId)?.counts ?? ZERO;
  const document = async (accountId: string, sample = false) => {
    const [d] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, sample) VALUES ($1, 't', 't.pdf', 'application/pdf', 1, $2, '\\x00', $3) RETURNING id",
      [accountId, randomUUID(), sample],
    );
    return d!.id;
  };
  const analysis = async (documentId: string) => {
    const [a] = await query<{ id: string }>(
      "INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'compliance-check', 'running', 'credit') RETURNING id",
      [documentId],
    );
    return a!.id;
  };
  const paid = (accountId: string): PaymentEvent =>
    ({
      type: "payment_paid",
      id: `evt_${randomUUID()}`,
      kind: "document",
      accountId,
      customerId: null,
      metadata: {},
      checkoutRef: null,
      paymentRef: `pay_${randomUUID()}`,
      invoiceRef: null,
      amountTotal: 999,
      amountDiscount: 0,
      currency: "cad",
    }) as unknown as PaymentEvent;
  const apply = (e: PaymentEvent) => applyPaymentEvent(transaction, e);
  const refusal = (work: Promise<unknown>) =>
    work.then(
      () => null,
      (e: unknown) => e as HttpError,
    );

  it("activated counts once when a code opens a pilot; the same redemption replayed counts nothing more", async () => {
    const c = await pilot();
    const id = await account();
    const key = `t-${randomUUID()}`;
    await activate(c.code, id, key);
    expect(await refusal(activate(c.code, id, key))).toBeInstanceOf(HttpError);
    expect((await counts(c.id)).activated).toBe(1);
  });

  it("a refused second pilot code counts nothing", async () => {
    const [a, b] = [await pilot(), await pilot()];
    const id = await account();
    await activate(a.code, id);
    expect(await refusal(activate(b.code, id))).toBeInstanceOf(HttpError);
    expect((await counts(b.id)).activated).toBe(0);
  });

  it("first_real_file counts the account's first non-sample file once, however often it is recorded or how many files follow", async () => {
    const c = await pilot(5);
    const id = await account();
    await activate(c.code, id);
    await recordRealFile(id, await analysis(await document(id, true)));
    expect((await counts(c.id)).first_real_file).toBe(0);
    const first = await analysis(await document(id));
    await recordRealFile(id, first);
    await recordRealFile(id, first);
    await recordRealFile(id, await analysis(await document(id)));
    expect((await counts(c.id)).first_real_file).toBe(1);
  });

  it("two first files started at once count once", async () => {
    const c = await pilot(5);
    const id = await account();
    await activate(c.code, id);
    const [a, b] = [await analysis(await document(id)), await analysis(await document(id))];
    await Promise.all([recordRealFile(id, a), recordRealFile(id, b)]);
    expect((await counts(c.id)).first_real_file).toBe(1);
  });

  it("first_payment and second_payment count on the account's first and second payment; a replayed event counts nothing", async () => {
    const c = await pilot();
    const id = await account();
    await activate(c.code, id);
    const one = paid(id);
    expect(await apply(one)).toBe("applied");
    expect(await apply(one)).toBe("duplicate");
    let n = await counts(c.id);
    expect([n.first_payment, n.second_payment]).toEqual([1, 0]);
    await apply(paid(id));
    await apply(paid(id));
    n = await counts(c.id);
    expect([n.first_payment, n.second_payment]).toEqual([1, 1]);
  });

  it("an account without a pilot changes no counter", async () => {
    const c = await pilot();
    const id = await account();
    await recordRealFile(id, await analysis(await document(id)));
    await apply(paid(id));
    expect(await counts(c.id)).toEqual(ZERO);
    expect(await query("SELECT 1 FROM public.pilot_counter WHERE coupon_id = $1", [c.id])).toHaveLength(0);
  });

  it("the stored counts hold nothing about a person: a code, a stage and an integer", async () => {
    const c = await pilot();
    await activate(c.code, await account());
    const columns = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pilot_counter' ORDER BY column_name",
    );
    expect(columns.map((x) => x.column_name)).toEqual(["coupon_id", "n", "stage"]);
    expect(Object.values(PILOT_STAGE).sort()).toEqual([
      "activated",
      "first_payment",
      "first_real_file",
      "second_payment",
    ]);
    expect(await query("SELECT * FROM public.pilot_counter WHERE coupon_id = $1", [c.id])).toHaveLength(1);
  });

  it("journey: with an allowance of 1, the first file is free, the second is refused 402 PAYWALL; after a payment it runs", async () => {
    const c = await pilot(1);
    const id = await account();
    await activate(c.code, id);
    expect(await reserveAudit(query, id, NOW, CAPS)).toBe("credit");
    const refused = await refusal(reserveAudit(query, id, NOW, CAPS));
    expect(refused).toBeInstanceOf(HttpError);
    expect([refused!.status, refused!.body.code]).toEqual([402, "PAYWALL"]);
    await apply(paid(id));
    expect(await reserveAudit(query, id, NOW, CAPS)).toBe("credit");
    expect((await counts(c.id)).first_payment).toBe(1);
  });

  it("an account without a pilot is refused as before (no free allowance)", async () => {
    const refused = await refusal(reserveAudit(query, await account(), NOW, CAPS));
    expect(refused?.body.code).toBe("PAYWALL");
  });
});
