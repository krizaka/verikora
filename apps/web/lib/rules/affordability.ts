/**
 * The share of income that a rent takes (verikora#557, slice 2 of #104) — INFORMATION for the landlord, nothing else.
 * Pure and deterministic, in integer cents and basis points. It speaks only of two figures, never of the person.
 *
 * Guardrail (CTO, 2026-10-29, #557/#558): there is NO pass/fail, NO score, NO threshold and NO refusal reason here.
 * In Québec, a landlord may check an applicant's ability to pay, but a refusal founded on an income criterion can be
 * discrimination on social condition (Charter of human rights and freedoms, s. 10 and 12). The Commission des droits de
 * la personne et des droits de la jeunesse (CDPDJ) lists a modest income and welfare benefits as social condition
 * (https://www.cdpdj.qc.ca/fr/nos-services/outils-en-ligne/louer-sans-discrimination), asks landlords to take proof of
 * income rather than a credit check, and says a person without rental history cannot be refused for that alone
 * (https://www.cdpdj.qc.ca/fr/foire-aux-questions/logement-proprietaires-ou-mandataires). The share must therefore never
 * be the sole criterion; the messages say so. NOT VERIFIED word for word: a CDPDJ text on a rent-to-income ratio
 * specifically (the sources above do not name one) — kept on the legal checklist for the lawyer review (#96).
 * The income is a figure the applicant chose to give, used in memory and never stored (the CAI finds a salary not
 * necessary to require).
 */
export const AFFORDABILITY_RULE = { id: "TS-A-001" } as const;

export interface AffordabilityInput {
  /** The monthly rent of the lease, in integer cents. */
  rentCents: number;
  /** The gross monthly income the applicant gave, in integer cents; absent when none was given. */
  monthlyIncomeCents?: number;
}

export type AffordabilityResult =
  | {
      ruleId: typeof AFFORDABILITY_RULE.id;
      code: "share";
      figures: { rentCents: number; monthlyIncomeCents: number; shareBasisPoints: number };
    }
  | { ruleId: typeof AFFORDABILITY_RULE.id; code: "no-claim"; figures: { rentCents: number } };

const isPositiveInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

export function checkAffordability({ rentCents, monthlyIncomeCents }: AffordabilityInput): AffordabilityResult {
  if (!isPositiveInt(rentCents) || !isPositiveInt(monthlyIncomeCents)) {
    return { ruleId: AFFORDABILITY_RULE.id, code: "no-claim", figures: { rentCents } };
  }
  const shareBasisPoints = Math.round((rentCents * 10_000) / monthlyIncomeCents);
  return { ruleId: AFFORDABILITY_RULE.id, code: "share", figures: { rentCents, monthlyIncomeCents, shareBasisPoints } };
}

/** The message key of a result, under `affordability.<code>` in the catalogues. */
export const affordabilityMessageKey = (r: Pick<AffordabilityResult, "code">) => `affordability.${r.code}` as const;
