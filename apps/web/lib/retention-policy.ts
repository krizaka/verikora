import { query } from "./db";

/*
 * Retention as data (yomizaka#125). A policy is a row of `retention_policies` (after-check, after-decision, or a number of days);
 * a document type points at one; an owner may override a subject with a `retention_rule`; the screening result's window is the
 * global rule of the subject « screening-result ». No day count is typed in code: a row changes it, no deploy.
 */
export const SUBJECT = { screeningResult: "screening-result" } as const;

export interface Policy {
  id: string;
  purgeOn: "after-check" | "after-decision" | "days";
  days: number | null;
}
interface Candidate {
  policy: Policy;
  /** 0 = the owner's own rule, 1 = the global rule, 2 = the document type's. */
  rank: 0 | 1 | 2;
}

/** Pure: the rule in force — the owner's own, then the global one, then the document type's own policy. */
export function inForce(candidates: readonly Candidate[]): Policy | null {
  return [...candidates].sort((a, b) => a.rank - b.rank)[0]?.policy ?? null;
}

/** Pure: the days a result is kept, from the policy in force. A policy that is not « days » keeps nothing past the check: 0. */
export const resultDays = (p: Policy | null): number => (p?.purgeOn === "days" ? (p.days ?? 0) : 0);

interface PolicyRow {
  id: string;
  purge_on: Policy["purgeOn"];
  days: number | null;
  rank: 0 | 1 | 2;
}

/** The policy in force for an owner and a subject (a document type id, or « screening-result »). Null: no row says anything. */
export async function policyFor(ownerId: string, subject: string): Promise<Policy | null> {
  const rows = await query<PolicyRow>(
    `SELECT p.id, p.purge_on, p.days, CASE WHEN r.owner_id IS NULL THEN 1 ELSE 0 END AS rank
       FROM retention_rule r JOIN retention_policies p ON p.id = r.policy_id
      WHERE r.subject = $2 AND (r.owner_id = $1 OR r.owner_id IS NULL)
     UNION ALL
     SELECT p.id, p.purge_on, p.days, 2 AS rank FROM document_types t JOIN retention_policies p ON p.id = t.retention_policy WHERE t.id = $2`,
    [ownerId, subject],
  );
  return inForce(rows.map((r) => ({ policy: { id: r.id, purgeOn: r.purge_on, days: r.days }, rank: r.rank })));
}
