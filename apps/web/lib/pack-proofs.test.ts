import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { reportOf, sovkoraRun } from "@verikora/core";
import { describe, expect, it } from "vitest";

/**
 * The three Québec rulesets, proven by real Sovkora runs on whole demo documents (scripts/record-packs.mjs). A recording is
 * never edited by hand: the run, the ruleset and the verdicts below are what Sovkora returned. The quoted passages are the
 * document's own words.
 */
const DIR = join(__dirname, "../content/pack-proofs");
const proofs = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, f), "utf8"))]),
);

const EXPECT: Record<string, { ruleset: string; version: string; failed: string[]; rules: number }> = {
  "qc-residential-lease--fr-compliant": {
    ruleset: "qc-residential-lease",
    version: "2024-02-21",
    failed: [],
    rules: 10,
  },
  "qc-residential-lease--fr-defective": {
    ruleset: "qc-residential-lease",
    version: "2024-02-21",
    failed: ["QC-LEASE-004", "QC-LEASE-005", "QC-LEASE-006", "QC-LEASE-007", "QC-LEASE-008", "QC-LEASE-020"],
    rules: 10,
  },
  "qc-invoice--krizaka-bilingual-aligned": { ruleset: "qc-invoice", version: "2024-06-20", failed: [], rules: 8 },
  "qc-service-contract--fr-compliant": { ruleset: "qc-service-contract", version: "2026-10-19", failed: [], rules: 4 },
  "qc-service-contract--en-defective": {
    ruleset: "qc-service-contract",
    version: "2026-10-19",
    failed: ["QC-SVC-001", "QC-SVC-002", "QC-SVC-004"],
    rules: 4,
  },
};

describe("the Québec packs, proven by recorded Sovkora runs", () => {
  it("holds one recording per expected document and nothing else", () => {
    expect(Object.keys(proofs).sort()).toEqual(Object.keys(EXPECT).sort());
  });

  it.each(Object.entries(EXPECT))("%s", (name, want) => {
    const rec = proofs[name];
    const run = sovkoraRun.parse(rec.run);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    const report = reportOf("compliance-check", run.outputs);
    expect(report).not.toBeNull();
    if (!report || !("findings" in report)) throw new Error("no compliance report");
    expect(report.rulesetId).toBe(want.ruleset);
    expect(report.rulesetVersion).toBe(want.version);
    expect(
      report.findings
        .filter((f) => f.verdict === "FAIL")
        .map((f) => f.ruleId)
        .sort(),
    ).toEqual(want.failed);
    // QC-LEASE-020 is the advisory judgment rule (asked of a model by the blueprint); the other rules are deterministic.
    expect(report.findings.length).toBeGreaterThanOrEqual(want.rules - 1);
    // Every verdict carries the passage it relied on when the document had one.
    for (const f of report.findings.filter((x) => x.verdict === "FAIL" && x.evidenceSpan))
      expect(rec.document.text).toContain(f.evidenceSpan!.quote);
  });
});
