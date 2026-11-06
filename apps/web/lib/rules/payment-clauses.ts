/**
 * What a Québec lease asks the tenant to pay up front (verikora#104, slice 3: the part of the illegal-clause scanner the law settles in
 * one article). Art. 1904 C.c.Q.: the landlord may require in advance only the first term of the rent, within one month; no sum other
 * than the rent (a deposit, however it is called) and no postdated cheques may be demanded. Pure and deterministic, from structured
 * figures the caller read from the lease — never from free text, so it claims only what it was given. It speaks of the lease, not of
 * the landlord. Information, not legal advice (the messages say so).
 */
export interface PaymentClausesInput {
  /** Terms of rent asked in advance, expressed in months. */
  advanceMonths?: number;
  /** A sum asked besides the rent (deposit, key money, guarantee), in integer cents. */
  depositCents?: number;
  /** The lease requires postdated cheques. */
  postdatedCheques?: boolean;
}

export const PAYMENT_CLAUSES_RULE = { id: "TS-P-001", citation: "C.c.Q., art. 1904" } as const;

export type PaymentClauseCode = "advance-over-one-month" | "deposit" | "postdated-cheques";

export interface PaymentClausesResult {
  ruleId: typeof PAYMENT_CLAUSES_RULE.id;
  status: "ok" | "finding" | "no-claim";
  findings: { code: PaymentClauseCode }[];
  citations: string[];
}

const usable = (n: number | undefined): boolean => n === undefined || (Number.isFinite(n) && n >= 0);

export function checkPaymentClauses(input: PaymentClausesInput): PaymentClausesResult {
  const base = { ruleId: PAYMENT_CLAUSES_RULE.id } as const;
  const { advanceMonths, depositCents } = input;
  if (
    !usable(advanceMonths) ||
    !usable(depositCents) ||
    (depositCents !== undefined && !Number.isInteger(depositCents))
  )
    return { ...base, status: "no-claim", findings: [], citations: [] };
  const findings: { code: PaymentClauseCode }[] = [];
  if (advanceMonths !== undefined && advanceMonths > 1) findings.push({ code: "advance-over-one-month" });
  if (depositCents !== undefined && depositCents > 0) findings.push({ code: "deposit" });
  if (input.postdatedCheques === true) findings.push({ code: "postdated-cheques" });
  return findings.length === 0
    ? { ...base, status: "ok", findings, citations: [] }
    : { ...base, status: "finding", findings, citations: [PAYMENT_CLAUSES_RULE.citation] };
}

/** The message key of a finding, under `paymentClauses.<code>` in the catalogues. */
export const paymentClauseMessageKey = (f: { code: PaymentClauseCode }) => `paymentClauses.${f.code}` as const;
