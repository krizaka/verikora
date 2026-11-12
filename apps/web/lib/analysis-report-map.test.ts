import { describe, expect, it } from "vitest";

import { analysisFindings, analysisStatusOf, analysisStatusOfTone, overallKeyOfTone } from "./analysis-report-map";

const say = (key: string) => key;
const f = (ruleId: string, verdict: string, severity = "MAJOR", extra: object = {}) => ({
  ruleId,
  title: `Titre ${ruleId}`,
  verdict,
  severity,
  explanation: `Explication ${ruleId}`,
  ...extra,
});

describe("the run's findings as AnalysisReport's", () => {
  it("reads a blocking failure as inconsistent, other points to look at as attention, met rules as consistent, the rest as unverified", () => {
    expect(analysisStatusOf(f("a", "FAIL", "BLOCKING"))).toBe("inconsistent");
    expect(analysisStatusOf(f("a", "FAIL", "MAJOR"))).toBe("attention");
    expect(analysisStatusOf(f("a", "INSUFFICIENT_EVIDENCE", "BLOCKING"))).toBe("attention");
    expect(analysisStatusOf(f("a", "PASS"))).toBe("consistent");
    expect(analysisStatusOf(f("a", "NOT_APPLICABLE"))).toBe("unverified");
    expect(analysisStatusOfTone("danger")).toBe("inconsistent");
    expect(analysisStatusOfTone("warning")).toBe("attention");
    expect(analysisStatusOfTone("success")).toBe("consistent");
  });

  it("carries the quote and the article from the report, never typed here, and a location only when the page can show it", () => {
    const run = [
      f("TS-G-001", "FAIL", "MAJOR", { evidenceSpan: { quote: "clause 6" }, citation: "C.c.Q., art. 1904, al. 1" }),
    ];
    const [one] = analysisFindings(run as never, say, "fr").findings;
    expect(one).toMatchObject({ quote: "clause 6", reference: { label: "C.c.Q., art. 1904, al. 1" } });
    expect(one).not.toHaveProperty("location");
    const located = analysisFindings(run as never, say, "fr", true);
    expect(located.findings[0]?.location).toBe("reportFace.seeInFile");
    expect(located.ruleIdOf.get(located.findings[0]!.id)).toBe("TS-G-001");
  });

  it("says when a failed finding quotes no passage, and when the evidence was not enough", () => {
    const [none] = analysisFindings([f("R1", "FAIL")] as never, say, "fr").findings;
    expect(none?.quote).toBeUndefined();
    expect(none?.observation).toContain("reportFace.noQuote");
    const [unsure] = analysisFindings([f("R2", "INSUFFICIENT_EVIDENCE")] as never, say, "fr").findings;
    expect(unsure?.observation).toContain("analysis.verdicts.INSUFFICIENT_EVIDENCE");
  });
});

describe("the overall status, read once in words", () => {
  it("is to fix when something blocks, to review when something needs a look, nothing to report otherwise", () => {
    expect(overallKeyOfTone("danger")).toBe("reportFace.overall.toFix");
    expect(overallKeyOfTone("warning")).toBe("reportFace.overall.toReview");
    expect(overallKeyOfTone("success")).toBe("reportFace.overall.nothing");
  });
});
