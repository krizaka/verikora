import { z } from "zod";

/*
 * The vocabulary of an external check, as Orazaka's engine answers it (orazaka-ai-engine `CheckResult`, #73): closed sets,
 * never free text. Yomizaka shows every outcome honestly and never invents one — a check that cannot run says so.
 */
export const CHECK_OUTCOME = { MATCH: "MATCH", NO_MATCH: "NO_MATCH", PENDING: "PENDING", PROVIDER_ERROR: "PROVIDER_ERROR", TIMEOUT: "TIMEOUT", REFUSED: "REFUSED" } as const;
export type CheckOutcome = (typeof CHECK_OUTCOME)[keyof typeof CHECK_OUTCOME];

export const CHECK_REFUSAL = { NO_CONSENT: "NO_CONSENT", NO_KEY: "NO_KEY", BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED", NOT_CONFIGURED: "NOT_CONFIGURED" } as const;
export type CheckRefusal = (typeof CHECK_REFUSAL)[keyof typeof CHECK_REFUSAL];

/** The engine's closed category of a file found. Never the record's content. */
export const CHECK_CATEGORY = { TAL_NON_PAYMENT: "TAL_NON_PAYMENT", TAL_OTHER: "TAL_OTHER", CRIMINAL: "CRIMINAL", CIVIL: "CIVIL", NONE: "NONE" } as const;

/** The purposes Yomizaka asks of the engine. Identity is never one of them: Yomizaka does document verification and screening, not ID verification. */
export const CHECK_PURPOSE = { COURT_RECORDS: "COURT_RECORDS", CREDIT: "CREDIT" } as const;
export type CheckPurpose = (typeof CHECK_PURPOSE)[keyof typeof CHECK_PURPOSE];

export const checkResult = z.object({
  outcome: z.enum(Object.values(CHECK_OUTCOME) as [CheckOutcome, ...CheckOutcome[]]),
  refusal: z.enum(Object.values(CHECK_REFUSAL) as [CheckRefusal, ...CheckRefusal[]]).nullable().default(null),
  category: z.enum(Object.values(CHECK_CATEGORY) as [string, ...string[]]).default("NONE"),
  /** The provider's opaque reference: kept to collect a pending answer, never shown, never a name or a figure. */
  providerRef: z.string().max(200).nullable().default(null),
});
export type CheckResult = z.infer<typeof checkResult>;

/** Who is checked: an opaque id the engine hashes, and the names it needs to search. Names never reach the audit or the stored result. */
export interface CheckSubject {
  subjectId: string;
  firstName: string;
  lastName: string;
}
/** One call: the run id stays on the engine's audit line; the region routes court records (Québec ≠ the rest). */
export interface CheckCall {
  userId: string;
  runId: string;
  subject: CheckSubject;
  region: string;
}

/** What a check is, in the screening's own words. Pure. */
export const CHECK_STATE = { answered: "answered", pending: "pending", unavailable: "unavailable", soon: "soon" } as const;
export type CheckState = (typeof CHECK_STATE)[keyof typeof CHECK_STATE];

/** NOT_CONFIGURED (and an engine without a key) read « not available yet », never as a failure of the person or a result. */
export function stateOf(result: Pick<CheckResult, "outcome" | "refusal">): CheckState {
  switch (result.outcome) {
    case CHECK_OUTCOME.MATCH:
    case CHECK_OUTCOME.NO_MATCH:
      return CHECK_STATE.answered;
    case CHECK_OUTCOME.PENDING:
      return CHECK_STATE.pending;
    case CHECK_OUTCOME.REFUSED:
      return result.refusal === CHECK_REFUSAL.NOT_CONFIGURED || result.refusal === CHECK_REFUSAL.NO_KEY ? CHECK_STATE.soon : CHECK_STATE.unavailable;
    default:
      return CHECK_STATE.unavailable;
  }
}
