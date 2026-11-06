import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { paymentLine } from "./PaymentHistory";

const sayIn = (dict: typeof en) => (key: string, vars?: Record<string, string | number>) => {
  const words = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], dict.console) as string;
  return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), words ?? key);
};
const P = {
  id: "ch_1",
  at: "2026-10-12T15:00:00.000Z",
  what: "Verikora — one document verified",
  amountCents: 999,
  currency: "cad",
  state: "paid" as const,
  receiptUrl: "https://pay.stripe.com/receipts/payment/abc",
};

describe("a payment line (verikora#585)", () => {
  it("says the day, what, the amount in the language, the state and a receipt label naming the day", () => {
    const l = paymentLine(P, sayIn(fr), "fr");
    expect(l.amount).toMatch(/9,99/);
    expect(l.state).toBe(fr.console.settings.billing.history.paid);
    expect(l.receipt).toContain(l.day);
    expect(paymentLine(P, sayIn(en), "en").amount).toContain("9.99");
  });
  it("a payment with no description is just « Payment », a refunded one says so", () => {
    expect(paymentLine({ ...P, what: null, state: "refunded" }, sayIn(en), "en")).toMatchObject({
      what: "Payment",
      state: "Refunded",
    });
  });
  it("EN and FR both carry every history word", () => {
    expect(Object.keys(en.console.settings.billing.history).sort()).toEqual(
      Object.keys(fr.console.settings.billing.history).sort(),
    );
  });
});
