import { type ComplianceReport, complianceReport } from "@verikora/core";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import { missingRuleTexts } from "../rule-text";
import { paymentInputFromFacts } from "./payment-clauses-facts";
import { withPaymentClauses } from "./payment-clauses-report";
import { LEASE_RULESET } from "./section-g-report";

const report = (facts: ComplianceReport["facts"], rulesetId = LEASE_RULESET): ComplianceReport => ({
  rulesetId,
  rulesetVersion: "2024-02-21",
  jurisdiction: "QC",
  asOf: "2026-10-15",
  summary: { byVerdict: { PASS: 1 }, blockingFailures: 0, rulesEvaluated: 1 },
  findings: [
    { ruleId: "QC-LEASE-003", severity: "BLOCKING", verdict: "PASS", explanation: "Le loyer est chiffré au bail." },
  ],
  facts,
});

describe("withPaymentClauses", () => {
  it("fails with the clause, the article and the disclaimer, and counts it", () => {
    const out = withPaymentClauses(
      report({ depositCents: { status: "found", cents: 95_000 }, postdatedCheques: { status: "found", flag: true } }),
    );
    const f = out.findings.find((x) => x.ruleId === "TS-P-001");
    expect(f).toMatchObject({ verdict: "FAIL", citation: "C.c.Q., art. 1904", method: "DETERMINISTIC" });
    expect(f?.explanation).toContain("chèques postdatés");
    expect(f?.explanation).toContain("pas un avis juridique");
    expect(out.summary).toMatchObject({ byVerdict: { PASS: 1, FAIL: 1 }, rulesEvaluated: 2 });
  });

  it("passes when the figures read stay within the article", () => {
    const f = withPaymentClauses(
      report({ advanceMonths: { status: "found", months: 1 }, postdatedCheques: { status: "found", flag: false } }),
    ).findings.at(-1);
    expect(f).toMatchObject({ ruleId: "TS-P-001", verdict: "PASS", citation: "C.c.Q., art. 1904" });
  });

  it("says nothing without a figure, for another ruleset, or twice", () => {
    const none = report({ rentCents: { status: "found", cents: 95_000 } });
    expect(withPaymentClauses(none)).toBe(none);
    const other = report({ depositCents: { status: "found", cents: 95_000 } }, "qc-invoice");
    expect(withPaymentClauses(other)).toBe(other);
    const once = withPaymentClauses(report({ depositCents: { status: "found", cents: 95_000 } }));
    expect(withPaymentClauses(once)).toBe(once);
  });

  it("reads only found figures; the other kinds of fact are ignored", () => {
    expect(
      paymentInputFromFacts({ advanceMonths: { status: "blank" }, depositCents: { status: "absent" } }),
    ).toBeNull();
    expect(paymentInputFromFacts({ advanceMonths: { status: "found", months: 2 } })).toEqual({ advanceMonths: 2 });
  });

  it("keeps the sentences in both languages and the rule named in both", () => {
    expect(en.paymentClauses.ok).toContain("1904");
    expect(missingRuleTexts(["TS-P-001"])).toEqual([]);
  });

  it("the report schema accepts the new fact kinds and drops unknown shapes with the facts, never the report", () => {
    const base = report(undefined);
    const ok = complianceReport.parse({
      ...base,
      facts: {
        advanceMonths: { status: "found", months: 2 },
        startsOn: { status: "found", date: "2026-07-01" },
        postdatedCheques: { status: "found", flag: true },
      },
    });
    expect(Object.keys(ok.facts ?? {})).toHaveLength(3);
    expect(complianceReport.parse({ ...base, facts: { x: { status: "found", weird: 1 } } }).facts).toBeUndefined();
  });
});

describe("English twin", () => {
  it("is stored beside the French sentence and used by the English reader", async () => {
    const { ruleExplanation } = await import("../rule-text");
    const f = withPaymentClauses(report({ postdatedCheques: { status: "found", flag: true } })).findings.at(-1)!;
    expect(f.explanationEn).toContain("postdated cheques");
    expect(ruleExplanation(f.ruleId, "en", f.explanation, f.explanationEn)).toBe(f.explanationEn);
    expect(ruleExplanation(f.ruleId, "fr", f.explanation, f.explanationEn)).toBe(f.explanation);
  });
});
