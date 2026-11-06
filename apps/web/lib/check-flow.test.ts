import { describe, expect, it } from "vitest";

import { afterUpload, groupingOffered, keepAppliesToNext, optionsShown, planCheck, rulesFor } from "./check-flow";

const file = (name: string, type: string) => ({ name, type });
const DAY = "2026-10-24";
const insight = (
  documentType: "lease" | "invoice" | "contract" | "visit-notice" | "premises-condition" | null,
  confidence: "high" | "medium" | "low" | "unknown",
) => ({
  nature: { id: documentType ?? "unknown", label: { fr: "", en: "" }, confidence, score: 0.9 },
  check: documentType
    ? {
        studio: "compliance-check" as const,
        documentType,
        ruleset: documentType === "lease" ? null : `qc-${documentType}`,
      }
    : null,
});

describe("the check flow (the UX review's Y4)", () => {
  it("the rules follow the kind: a lease by its jurisdiction and its dated version, an invoice and a contract by Québec's named rulesets", () => {
    expect(rulesFor("lease", "QC", DAY)).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-residential-lease/2026-10-24",
      asOf: DAY,
    });
    expect(rulesFor("lease", "FR", DAY)).toEqual({ studio: "compliance-check", jurisdiction: "FR", asOf: DAY });
    expect(rulesFor("invoice", "QC", DAY)).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-invoice",
      asOf: DAY,
    });
    expect(rulesFor("contract", "FR", DAY)).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-service-contract",
      asOf: DAY,
    });
  });

  it("starts the check on the drop when the person named the kind, and lands on the report", () => {
    expect(afterUpload({ requested: "invoice", insight: null, asOf: DAY })).toEqual({
      start: { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice", asOf: DAY },
      confirm: false,
      tab: "verifications",
      mismatch: null,
      unsupported: false,
    });
  });

  it("a lease's jurisdiction is established before its audit is spent: one offered, it is the one; several, the report tab asks", () => {
    expect(afterUpload({ requested: "lease", insight: null, jurisdictions: ["FR"], asOf: DAY }).start).toEqual({
      studio: "compliance-check",
      jurisdiction: "FR",
      asOf: DAY,
    });
    expect(
      afterUpload({ requested: "lease", insight: null, jurisdictions: ["QC", "FR", "BE-WAL"], asOf: DAY }),
    ).toMatchObject({ start: null, confirm: true });
    expect(
      afterUpload({ requested: "auto", insight: insight("lease", "high"), jurisdictions: ["QC", "FR"], asOf: DAY })
        .confirm,
    ).toBe(true);
    expect(afterUpload({ requested: "invoice", insight: null, jurisdictions: ["QC", "FR"], asOf: DAY }).start).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-invoice",
      asOf: DAY,
    });
  });

  it("starts it when Verikora recognised the kind with high confidence; asks to confirm otherwise, or when it is another kind of document", () => {
    expect(afterUpload({ requested: "auto", insight: insight("lease", "high"), asOf: DAY })).toEqual({
      start: { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-residential-lease/2026-10-24", asOf: DAY },
      confirm: false,
      tab: "verifications",
      mismatch: null,
      unsupported: false,
    });
    expect(afterUpload({ requested: "auto", insight: insight("contract", "high"), asOf: DAY }).start).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-service-contract",
      asOf: DAY,
    });
    expect(afterUpload({ requested: "auto", insight: insight("lease", "medium"), asOf: DAY })).toMatchObject({
      start: null,
      confirm: true,
    });
    expect(afterUpload({ requested: "auto", insight: insight(null, "high"), asOf: DAY })).toMatchObject({
      start: null,
      confirm: true,
      unsupported: false,
    });
    expect(afterUpload({ requested: "auto", insight: null, asOf: DAY })).toMatchObject({ start: null, confirm: true });
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

describe("the keep choice and the files already sent", () => {
  it("a tick after the drop applies to the next documents, and the page says so; before the drop it applies to the file", () => {
    expect(keepAppliesToNext([{ name: "bail.pdf" }], false)).toBe(true);
    expect(keepAppliesToNext([], false)).toBe(false);
    // « Vérifier un document » asks the defaults before the drop: the choice is the file's own.
    expect(keepAppliesToNext([{ name: "bail.pdf" }], true)).toBe(false);
  });
});

describe("the kind the person declared and the kind Verikora detected (ADR-089)", () => {
  it("the mismatch is shown and nothing runs by itself: the declared kind stays the default until the person confirms", () => {
    const plan = afterUpload({ requested: "lease", insight: insight("visit-notice", "high"), asOf: DAY });
    expect(plan).toEqual({
      start: null,
      confirm: true,
      tab: "verifications",
      mismatch: { declared: "lease", detected: "visit-notice" },
      unsupported: false,
    });
  });

  it("a visit notice or an état des lieux declared as another kind is never judged as a lease", () => {
    expect(planCheck({ declared: "other", detected: "premises-condition", asOf: DAY }).start).toBeNull();
    expect(planCheck({ declared: "other", detected: "premises-condition", asOf: DAY }).mismatch).toEqual({
      declared: "other",
      detected: "premises-condition",
    });
  });

  it("a declared kind the detection agrees with is not a mismatch", () => {
    expect(planCheck({ declared: "invoice", detected: "invoice", asOf: DAY }).mismatch).toBeNull();
  });
});

describe("the unsupported kind says so (« pas encore vérifié contre la loi »)", () => {
  it("an other document is not verified, and no lease ruleset is offered for it", () => {
    expect(planCheck({ declared: "other", detected: null, asOf: DAY })).toEqual({
      start: null,
      confirm: true,
      tab: "verifications",
      mismatch: null,
      unsupported: true,
    });
  });

  it("a kind with no ruleset in force on the date is unsupported, not run under another kind's rules", () => {
    expect(planCheck({ declared: "auto", detected: "visit-notice", asOf: "2026-10-01" })).toEqual({
      start: null,
      confirm: true,
      tab: "verifications",
      mismatch: null,
      unsupported: true,
    });
  });
});

describe("the date picks the ruleset version", () => {
  it("a lease checked before the 2026-10-24 release names the version then in force; on or after it, the new one", () => {
    expect(rulesFor("lease", "QC", "2026-10-23")).toMatchObject({
      ruleset: "qc-residential-lease/2024-02-21",
      asOf: "2026-10-23",
    });
    expect(rulesFor("lease", "QC", "2026-10-24")).toMatchObject({
      ruleset: "qc-residential-lease/2026-10-24",
      asOf: "2026-10-24",
    });
  });
});
