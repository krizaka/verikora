import type { ReportFact } from "@verikora/core";

import type { PaymentClausesInput } from "./payment-clauses";

type Facts = Readonly<Record<string, ReportFact>> | undefined;

/**
 * The payment clauses' input from the figures the lease ruleset exposes (`facts`): `advanceMonths` (months of rent asked in advance),
 * `depositCents` (a sum besides the rent), `postdatedCheques` (yes/no). Only a figure found is used, nothing is guessed from the text;
 * no figure at all gives no input, so no claim.
 */
export function paymentInputFromFacts(facts: Facts): PaymentClausesInput | null {
  const months = facts?.advanceMonths;
  const deposit = facts?.depositCents;
  const cheques = facts?.postdatedCheques;
  const input: PaymentClausesInput = {
    ...(months && "months" in months ? { advanceMonths: months.months } : {}),
    ...(deposit && "cents" in deposit ? { depositCents: deposit.cents } : {}),
    ...(cheques && "flag" in cheques ? { postdatedCheques: cheques.flag } : {}),
  };
  return Object.keys(input).length > 0 ? input : null;
}
