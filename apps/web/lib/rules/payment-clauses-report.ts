import type { ComplianceReport } from "@verikora/core";

import en from "../../messages/documents/en.json";
import fr from "../../messages/documents/fr.json";
import { ruleTitle } from "../rule-text";
import { checkPaymentClauses, PAYMENT_CLAUSES_RULE, type PaymentClausesResult } from "./payment-clauses";
import { paymentInputFromFacts } from "./payment-clauses-facts";
import { appendFinding } from "./report-finding";
import { LEASE_RULESET } from "./section-g-report";

type Messages = Record<string, string>;

/** A finding fails, an ok passes, a no-claim is not a finding. */
const VERDICT: Record<PaymentClausesResult["status"], string | null> = {
  finding: "FAIL",
  ok: "PASS",
  "no-claim": null,
};

/**
 * Adds the payment clauses' finding (TS-P-001, art. 1904 C.c.Q.) to a Québec lease report that carries the figures, once (verikora#104).
 * A finding fails and says which clause; clauses within the article pass; a report without the figures, or another ruleset, is returned as it came.
 * Stored in French like the engine's own findings, the title and sentence follow the reader's language through the catalogue. Information,
 * not legal advice: the disclaimer always ends the text.
 */
export function withPaymentClauses(report: ComplianceReport): ComplianceReport {
  if (report.rulesetId !== LEASE_RULESET) return report;
  const input = paymentInputFromFacts(report.facts);
  if (!input) return report;
  const result = checkPaymentClauses(input);
  const verdict = VERDICT[result.status];
  if (!verdict) return report;
  const failing = verdict === "FAIL";
  const say = (messages: Messages) =>
    [
      ...result.findings.map((f) => messages[f.code] ?? ""),
      ...(failing ? [] : [messages.ok ?? ""]),
      messages.disclaimer,
    ]
      .filter(Boolean)
      .join(" ");
  return appendFinding(report, {
    ruleId: result.ruleId,
    title: ruleTitle(PAYMENT_CLAUSES_RULE.id, "fr", null),
    severity: "MAJOR",
    verdict,
    explanation: say(fr.paymentClauses),
    explanationEn: say(en.paymentClauses),
    method: "DETERMINISTIC",
    ...(failing ? { citation: result.citations.join(" ; ") } : { citation: PAYMENT_CLAUSES_RULE.citation }),
  });
}
