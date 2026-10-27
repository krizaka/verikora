import { query } from "../db";
import { refuse } from "../http";
import { type CheckTypeRow, priceCents } from "./catalogue";
import { CHECK_STATE, type CheckState } from "./model";

/*
 * Per-check billing (yomizaka#133). A check's charge is its row's provider cost plus margin (price DATA, never code), billed to
 * the payer chosen for the request, with the taxes (GST/QST) computed by Stripe Tax and an invoice line that names the check as a
 * service by Krizaka. It is OFF (`features.screeningBilling`) and test-mode only: nothing here calls a live processor.
 *
 * TODO(krizaka-ts#132, B48): `@krizaka/payments` sells plans by lookup key; it has no ad-hoc per-check charge with Stripe Tax, an
 * invoice description and a refund. `BillingPort` below is the seam: when the package offers them (issue krizaka-ts "payments:
 * one-off charge + refund"), the adapter is written there and bound here. No local Stripe copy.
 */
export const PAYER = { firm: "firm", owner: "owner", applicant: "applicant" } as const;
export type Payer = (typeof PAYER)[keyof typeof PAYER];
export const PAYERS = Object.values(PAYER) as Payer[];

export interface ChargeRequest {
  /** Idempotency: one charge per application and check type. */
  key: string;
  payer: Payer;
  amountCents: number;
  currency: string;
  /** The invoice line (« Vérification … — service Krizaka »). */
  description: string;
  taxCode: "software-as-a-service";
}
export interface BillingPort {
  charge(request: ChargeRequest): Promise<{ ref: string }>;
  refund(ref: string): Promise<void>;
}
/** The port while the payments package cannot charge a check: it refuses, so a flag turned on by mistake bills nothing. */
export const closedBilling: BillingPort = {
  async charge() {
    throw refuse(503, "BILLING_NOT_CONFIGURED", "Per-check billing is not available yet");
  },
  async refund() {
    throw refuse(503, "BILLING_NOT_CONFIGURED", "Per-check billing is not available yet");
  },
};

/** Pure: what an application costs, line by line, from the rows (a free check has no line). */
export function quoteOf(types: readonly CheckTypeRow[]): { key: string; cents: number; currency: string }[] {
  return types.map((t) => ({ key: t.key, cents: priceCents(t), currency: t.currency }));
}
export const totalCents = (quote: readonly { cents: number }[]): number => quote.reduce((sum, l) => sum + l.cents, 0);

/** Pure: is this payer allowed for these types? The applicant pays only where every priced type allows it. */
export function payerAllowed(payer: Payer, types: readonly CheckTypeRow[]): boolean {
  return payer !== PAYER.applicant || types.every((t) => priceCents(t) === 0 || t.applicant_may_pay);
}

/** Pure: a check is charged when the provider accepted it (answered or pending) and it costs something; an error, a refusal or « not available yet » is never charged. */
export const isChargeable = (state: CheckState, cents: number): boolean => cents > 0 && (state === CHECK_STATE.answered || state === CHECK_STATE.pending);

/** Pure: a charged check that ends without an answer (the provider never answered) is refunded. */
export const isRefundable = (settledState: CheckState): boolean => settledState === CHECK_STATE.unavailable;

/** Pure: the invoice line, from a message with {check}. */
export const invoiceLine = (template: string, checkLabel: string): string => template.replace("{check}", checkLabel);

export interface ChargeInput {
  screeningId: string;
  type: CheckTypeRow;
  payer: Payer;
  description: string;
}
/** Charges one check once. A processor failure is recorded as « failed » and never blocks the check. Returns the state written. */
export async function chargeCheck(port: BillingPort, input: ChargeInput): Promise<"charged" | "failed" | "duplicate"> {
  const amount = priceCents(input.type);
  const [row] = await query<{ id: string }>(
    "INSERT INTO screening_charge (screening_id, check_type, payer, provider_cost_cents, margin_cents, amount_cents, currency, description, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'failed') ON CONFLICT (screening_id, check_type) DO NOTHING RETURNING id",
    [input.screeningId, input.type.key, input.payer, input.type.provider_cost_cents, input.type.margin_cents, amount, input.type.currency, input.description],
  );
  if (!row) return "duplicate";
  try {
    const { ref } = await port.charge({ key: `${input.screeningId}:${input.type.key}`, payer: input.payer, amountCents: amount, currency: input.type.currency.toLowerCase(), description: input.description, taxCode: "software-as-a-service" });
    await query("UPDATE screening_charge SET state = 'charged', charge_ref = $2 WHERE id = $1", [row.id, ref]);
    return "charged";
  } catch {
    return "failed";
  }
}
/** Refunds a charged check once (the state moves from « charged » to « refunded » or nothing happens). */
export async function refundCheck(port: BillingPort, screeningId: string, checkType: string, now: Date): Promise<boolean> {
  const [row] = await query<{ id: string; charge_ref: string }>("SELECT id, charge_ref FROM screening_charge WHERE screening_id = $1 AND check_type = $2 AND state = 'charged'", [screeningId, checkType]);
  if (!row) return false;
  await port.refund(row.charge_ref);
  const done = await query("UPDATE screening_charge SET state = 'refunded', refunded_at = $2 WHERE id = $1 AND state = 'charged' RETURNING id", [row.id, now]);
  return done.length > 0;
}
