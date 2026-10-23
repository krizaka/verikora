import { describe, expect, it } from "vitest";

import { afterUpload, groupingOffered, optionsShown, rulesFor } from "./check-flow";

const file = (name: string, type: string) => ({ name, type });
const insight = (documentType: "lease" | "invoice" | "contract" | null, confidence: "high" | "medium" | "low" | "unknown") => ({
  nature: { id: documentType ?? "unknown", label: { fr: "", en: "" }, confidence, score: 0.9 },
  check: documentType ? { studio: "compliance-check" as const, documentType, ruleset: documentType === "lease" ? null : `qc-${documentType}` } : null,
});

describe("the check flow (the UX review's Y4)", () => {
  it("the rules follow the kind: a lease by its jurisdiction, an invoice and a contract by Québec's named rulesets", () => {
    expect(rulesFor("lease")).toEqual({ studio: "compliance-check", jurisdiction: "QC" });
    expect(rulesFor("lease", "FR", "2026-10-23")).toEqual({ studio: "compliance-check", jurisdiction: "FR", asOf: "2026-10-23" });
    expect(rulesFor("invoice")).toEqual({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" });
    expect(rulesFor("contract", "FR")).toEqual({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-service-contract" });
  });

  it("starts the check on the drop when the person named the kind, and lands on the report", () => {
    expect(afterUpload({ requested: "invoice", insight: null })).toEqual({ start: { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" }, confirm: false, tab: "verifications" });
    expect(afterUpload({ requested: "lease", insight: insight("invoice", "high") }).start).toEqual({ studio: "compliance-check", jurisdiction: "QC" });
  });

  it("a lease's jurisdiction is established before its audit is spent: one offered, it is the one; several, the report tab asks", () => {
    expect(afterUpload({ requested: "lease", insight: null, jurisdictions: ["FR"] }).start).toEqual({ studio: "compliance-check", jurisdiction: "FR" });
    expect(afterUpload({ requested: "lease", insight: null, jurisdictions: ["QC", "FR", "BE-WAL"] })).toEqual({ start: null, confirm: true, tab: "verifications" });
    expect(afterUpload({ requested: "auto", insight: insight("lease", "high"), jurisdictions: ["QC", "FR"] }).confirm).toBe(true);
    expect(afterUpload({ requested: "invoice", insight: null, jurisdictions: ["QC", "FR"] }).start).toEqual({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" });
  });

  it("starts it when Yomizaka recognised the kind with high confidence; asks to confirm otherwise, or when it is another kind of document", () => {
    expect(afterUpload({ requested: "auto", insight: insight("lease", "high") })).toEqual({ start: { studio: "compliance-check", jurisdiction: "QC" }, confirm: false, tab: "verifications" });
    expect(afterUpload({ requested: "auto", insight: insight("contract", "high") }).start).toEqual({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-service-contract" });
    expect(afterUpload({ requested: "auto", insight: insight("lease", "medium") })).toEqual({ start: null, confirm: true, tab: "verifications" });
    expect(afterUpload({ requested: "auto", insight: insight(null, "high") })).toEqual({ start: null, confirm: true, tab: "verifications" });
    expect(afterUpload({ requested: "auto", insight: null })).toEqual({ start: null, confirm: true, tab: "verifications" });
    expect(afterUpload({ requested: "other", insight: insight("lease", "high") })).toEqual({ start: null, confirm: true, tab: "verifications" });
  });

  it("the options appear once files are known, and « these photos are one document » only with two photos or more", () => {
    expect(optionsShown([])).toBe(false);
    expect(optionsShown([file("bail.pdf", "application/pdf")])).toBe(true);
    expect(groupingOffered([])).toBe(false);
    expect(groupingOffered([file("p1.jpg", "image/jpeg")])).toBe(false);
    expect(groupingOffered([file("p1.jpg", "image/jpeg"), file("p2.heic", "")])).toBe(true);
    expect(groupingOffered([file("bail.pdf", "application/pdf"), file("p1.png", "image/png")])).toBe(false);
  });
});
