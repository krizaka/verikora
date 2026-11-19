import { describe, expect, it } from "vitest";

import { DOCX_MIME, ODT_MIME } from "@verikora/core";

import { availableChecks } from "./checks";

const doc = { kind: "lease", hasText: true, mimeType: "application/pdf" } as const;

describe("what a document can be checked for", () => {
  it("checks a lease against Québec's own rules, then its authenticity", () => {
    expect(availableChecks(doc)).toEqual([
      { studio: "compliance-check", jurisdiction: "QC" },
      { studio: "document-authenticity" },
    ]);
  });

  it.each([
    ["invoice", "qc-invoice"],
    ["contract", "qc-service-contract"],
  ] as const)("checks a %s against the %s ruleset", (kind, ruleset) => {
    expect(availableChecks({ ...doc, kind })[0]).toEqual({ studio: "compliance-check", jurisdiction: "QC", ruleset });
  });

  it("offers only the authenticity check for a scan with no text layer", () => {
    expect(availableChecks({ ...doc, hasText: false })).toEqual([{ studio: "document-authenticity" }]);
  });

  it("offers no authenticity check for a text file", () => {
    expect(availableChecks({ ...doc, mimeType: "text/plain" })).toEqual([
      { studio: "compliance-check", jurisdiction: "QC" },
    ]);
  });

  it("offers no compliance check for another kind: no ruleset is in force for it, and the lease's rules are never its fallback", () => {
    expect(availableChecks({ ...doc, kind: "other" })).toEqual([{ studio: "document-authenticity" }]);
  });

  it.each([DOCX_MIME, ODT_MIME] as const)("offers the authenticity check on %s, as the web does", (mimeType) => {
    expect(availableChecks({ ...doc, mimeType })).toContainEqual({ studio: "document-authenticity" });
  });

  it("offers nothing for a text file without text", () => {
    expect(availableChecks({ ...doc, hasText: false, mimeType: "text/plain" })).toEqual([]);
  });
});
