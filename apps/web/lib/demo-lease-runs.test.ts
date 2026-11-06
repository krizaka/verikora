import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ComplianceReport, reportOf, sovkoraRun } from "@verikora/core";
import { describe, expect, it } from "vitest";

// The two fictitious leases of issue #302, sent to Sovkora's Québec lease pack on dev (blueprint 1.4.0, after sovkora-packs#127)
// by scripts/record-demo-leases.mjs. The recordings are the answers exactly as Sovkora returned them; never edited by hand.
import { generateDocument } from "../../../scripts/demo-documents/index.mjs";

const DIR = join(__dirname, "../content/demo-lease-runs");
const recorded = (name: string) =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as {
    document: { text: string };
    generator: { id: string };
    run: unknown;
  };

/** The rules that the errors lease must fail, each with the passage it quotes and the article the pack cites. */
const EXPECTED_FAILS: Record<string, { quote: string; article: string }> = {
  "QC-LEASE-004": { quote: "dépôt de sécurité de 950,00 $", article: "1904" },
  "QC-LEASE-005": { quote: "chèques postdatés", article: "1904" },
  "QC-LEASE-006": { quote: "interdit d'avoir des enfants", article: "1899" },
  "QC-LEASE-020": { quote: "Il est interdit d'avoir des enfants dans le logement.", article: "1901" },
};

function reportOfRecording(name: string): { text: string; report: ComplianceReport } {
  const rec = recorded(name);
  const run = sovkoraRun.parse(rec.run);
  expect(run.status).toBe("SUCCEEDED");
  const report = reportOf("compliance-check", run.outputs);
  if (!report || !("findings" in report)) throw new Error(`${name}: no compliance report`);
  return { text: rec.document.text, report };
}

describe("the fictitious leases, checked by the Québec lease pack on dev", () => {
  it.each([
    ["clean", "bail-rosemont-1-conforme"],
    ["errors", "bail-rosemont-5-clause-illegale"],
  ])("the %s recording is the text the generator writes today", async (name, id) => {
    const doc = await generateDocument(id);
    expect(recorded(name).generator.id).toBe(id);
    expect(recorded(name).document.text).toBe(doc.text);
  });

  it.each(["clean", "errors"])(
    "%s: a PASS always carries the passage it judged, and every quote is a passage of the document",
    (name) => {
      const { text, report } = reportOfRecording(name);
      expect(report.rulesetId).toBe("qc-residential-lease");
      expect(report.findings.filter((f) => f.verdict === "PASS" && !f.evidenceSpan?.quote)).toEqual([]);
      for (const f of report.findings.filter((x) => x.evidenceSpan?.quote))
        expect(text, f.ruleId).toContain(f.evidenceSpan!.quote);
    },
  );

  it("clean: the lease raises no FAIL", () => {
    const { report } = reportOfRecording("clean");
    expect(report.findings.filter((f) => f.verdict === "FAIL")).toEqual([]);
  });

  it("clean: says the TAL form is attached, and QC-LEASE-014 (C.c.Q. 1895) is judged on that sentence, not failed", () => {
    const { text, report } = reportOfRecording("clean");
    expect(text).toContain("formulaire obligatoire du Tribunal administratif du logement");
    const rule = report.findings.find((f) => f.ruleId === "QC-LEASE-014");
    expect(rule?.verdict).not.toBe("FAIL");
  });

  it("errors: exactly the expected FAILs, each with its passage and the article it cites", () => {
    const { report } = reportOfRecording("errors");
    const fails = report.findings.filter((f) => f.verdict === "FAIL");
    expect(fails.map((f) => f.ruleId).sort()).toEqual(Object.keys(EXPECTED_FAILS).sort());
    for (const f of fails) {
      const want = EXPECTED_FAILS[f.ruleId]!;
      expect(f.evidenceSpan?.quote, f.ruleId).toBe(want.quote);
      expect(f.citation, f.ruleId).toContain(want.article);
    }
  });
});
