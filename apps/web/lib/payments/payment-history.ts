import type { StripeCall } from "@krizaka/payments";

/**
 * The payments of an account, as Account → Billing shows them (verikora#585): the date, what was bought, the amount, whether it was
 * refunded, and the processor's receipt link. Read from the processor on the server; only these facts leave this module, never a
 * card, a name or an address (the receipt page holds them, at the processor).
 */
export interface PaymentRow {
  id: string;
  at: string;
  /** The processor's line for what was bought, or null (the page then says « Payment »). */
  what: string | null;
  amountCents: number;
  currency: string;
  state: "paid" | "refunded";
  receiptUrl: string | null;
}

interface RawCharge {
  id?: unknown;
  created?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  paid?: unknown;
  refunded?: unknown;
  description?: unknown;
  receipt_url?: unknown;
}

/** The processor's state of a charge that went through. */
const CHARGE_DONE = new Set(["succeeded"]);
/** A receipt link is kept only when it is an https address on stripe.com or one of its subdomains. */
function isStripeReceipt(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

export function paymentHistoryOf(charges: readonly RawCharge[]): PaymentRow[] {
  return charges
    .filter(
      (c) =>
        c.paid === true &&
        CHARGE_DONE.has(String(c.status)) &&
        typeof c.id === "string" &&
        typeof c.created === "number" &&
        typeof c.amount === "number",
    )
    .map((c) => ({
      id: c.id as string,
      at: new Date((c.created as number) * 1000).toISOString(),
      what: typeof c.description === "string" && c.description.trim() ? c.description.trim() : null,
      amountCents: c.amount as number,
      currency: typeof c.currency === "string" ? c.currency : "cad",
      state: c.refunded === true ? ("refunded" as const) : ("paid" as const),
      receiptUrl: typeof c.receipt_url === "string" && isStripeReceipt(c.receipt_url) ? c.receipt_url : null,
    }));
}

/** The last charges of a customer, newest first (the processor's order). One read, nothing written. */
export async function fetchPaymentHistory(call: StripeCall, customerId: string, limit = 10): Promise<PaymentRow[]> {
  const answer = await call("GET", "/v1/charges", { customer: customerId, limit });
  return paymentHistoryOf(Array.isArray(answer.data) ? answer.data : []);
}
