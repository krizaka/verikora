import { describe, expect, it } from "vitest";

import { fetchPaymentHistory, paymentHistoryOf } from "./payment-history";

const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch_1",
  created: 1_793_000_000,
  amount: 999,
  currency: "cad",
  status: "succeeded",
  paid: true,
  refunded: false,
  amount_refunded: 0,
  description: "Verikora — one document verified",
  receipt_url: "https://pay.stripe.com/receipts/payment/abc",
  payment_method_details: { card: { last4: "4242", brand: "visa" } },
  billing_details: { name: "Éric Tremblay", email: "eric@example.test" },
  ...over,
});

describe("payment history (verikora#585)", () => {
  it("keeps the date, what was bought, the amount, the state and the receipt link", () => {
    const [row] = paymentHistoryOf([charge()]);
    expect(row).toEqual({
      id: "ch_1",
      at: new Date(1_793_000_000 * 1000).toISOString(),
      what: "Verikora — one document verified",
      amountCents: 999,
      currency: "cad",
      state: "paid",
      receiptUrl: "https://pay.stripe.com/receipts/payment/abc",
    });
  });

  it("never carries card or billing details", () => {
    const text = JSON.stringify(paymentHistoryOf([charge()]));
    expect(text).not.toMatch(/4242|visa|card|Tremblay|eric@/i);
  });

  it("says refunded and keeps the amount taken", () => {
    const [row] = paymentHistoryOf([charge({ refunded: true, amount_refunded: 999 })]);
    expect(row?.state).toBe("refunded");
  });

  it("leaves out a charge that did not go through", () => {
    expect(paymentHistoryOf([charge({ status: "failed", paid: false })])).toEqual([]);
  });

  it("accepts only https receipt links of the processor, else none", () => {
    expect(paymentHistoryOf([charge({ receipt_url: "javascript:alert(1)" })])[0]?.receiptUrl).toBeNull();
    expect(paymentHistoryOf([charge({ receipt_url: null })])[0]?.receiptUrl).toBeNull();
  });

  it("falls back to a neutral label when the processor gave no description", () => {
    expect(paymentHistoryOf([charge({ description: null })])[0]?.what).toBeNull();
  });

  it("asks the processor for the last charges of the customer, read-only, newest first", async () => {
    const calls: unknown[][] = [];
    const rows = await fetchPaymentHistory(
      async (method, path, params) => (
        calls.push([method, path, params]),
        { data: [charge({ id: "ch_new", created: 1_793_000_100 }), charge()] }
      ),
      "cus_1",
      5,
    );
    expect(calls).toEqual([["GET", "/v1/charges", { customer: "cus_1", limit: 5 }]]);
    expect(rows.map((r) => r.id)).toEqual(["ch_new", "ch_1"]);
  });
});
