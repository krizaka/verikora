import { analysePayStub, analysePdf, type ForensicsDocumentKind, type FraudReport, withTextRuns } from "@yomizaka/core";

import { readTextRuns } from "../forensics-runs";

/**
 * The traces of editing a PDF carries, as a `FraudReport` of signals with their level (ADR-0014: no score, never a verdict). The
 * bytes are read for revisions and producers (pure, linear), the typography by the isolated worker. A file the worker cannot read
 * (too heavy, too many pages, broken) still gets what its bytes say: a missing reading is not a finding.
 */
export async function examinePdf(bytes: Uint8Array, documentKind?: ForensicsDocumentKind): Promise<FraudReport> {
  const report = analysePdf(bytes, documentKind ? { documentKind } : {});
  try {
    const runs = await readTextRuns(bytes);
    const typed = withTextRuns(report, runs);
    // The arithmetic of a pay stub's own figures: only for a document that claims to be one.
    return documentKind === "payroll" ? { ...typed, anomalies: [...typed.anomalies, ...analysePayStub(runs)] } : typed;
  } catch {
    return report;
  }
}
