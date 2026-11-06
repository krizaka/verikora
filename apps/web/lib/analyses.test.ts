import { DOCX_MIME } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { keptInputs, runInputs, searchText } from "./analyses";
import { checkUpload, documentStatus, needsAttention, safeFilename, titleOf } from "./documents";
import { normaliseText } from "./pdf-text";
import { cleanPdf } from "./preflight/fixtures";
import { normaliseQuery, passageHtml } from "./search";

const LEASE = "CONTRAT DE LOCATION\nDépôt de garantie : 2 550 €.";
const pdf = (n: number) => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(n)]);

describe("what Verikora sends to Sovkora", () => {
  it("sends the named ruleset only when one was asked for, and never for another jurisdiction", () => {
    const doc = { mimeType: "application/pdf", text: LEASE, content: pdf(10) };
    const day = new Date("2026-10-19T12:00:00Z");
    expect(
      runInputs({ studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-invoice" }, doc, day),
    ).toMatchObject({ jurisdiction: "QC", ruleset: "qc-invoice", asOf: "2026-10-19" });
    expect(runInputs({ studio: "compliance-check", jurisdiction: "QC" }, doc, day)).not.toHaveProperty("ruleset");
  });
  it("never sends the dated lease reference to the Studio (its schema does not take it) but keeps it as its own record", () => {
    const doc = { mimeType: "application/pdf", text: LEASE, content: pdf(10) };
    const request = {
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: "qc-residential-lease/2026-10-24",
      asOf: "2026-10-29",
    } as const;
    const inputs = runInputs(request, doc);
    expect(inputs).not.toHaveProperty("ruleset");
    expect(keptInputs(request, inputs)).toEqual({
      jurisdiction: "QC",
      asOf: "2026-10-29",
      ruleset: "qc-residential-lease/2026-10-24",
    });
  });
  it("declares a visit notice or an état des lieux by its kind, and names only the invoice and the service contract as rulesets", () => {
    const doc = { mimeType: "application/pdf", text: LEASE, content: pdf(10) };
    expect(
      runInputs(
        { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-visit-notice", asOf: "2026-10-29" },
        doc,
      ),
    ).toMatchObject({ declaredKind: "NOTICE" });
    expect(
      runInputs(
        { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-premises-condition", asOf: "2026-10-29" },
        doc,
      ),
    ).toMatchObject({ declaredKind: "CONDITION_REPORT" });
    expect(
      runInputs(
        { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-service-contract", asOf: "2026-10-29" },
        doc,
      ),
    ).toMatchObject({ ruleset: "qc-service-contract" });
  });
  it("sends the text, the jurisdiction and today's date to the compliance Studio", () => {
    const inputs = runInputs(
      { studio: "compliance-check", jurisdiction: "FR" },
      { mimeType: "application/pdf", text: LEASE, content: pdf(10) },
      new Date("2026-10-14T12:00:00Z"),
    );
    expect(inputs).toEqual({ document: LEASE, jurisdiction: "FR", asOf: "2026-10-14" });
  });
  it("dates the check on the Québec day: 01:30 UTC on the 24th is still the 23rd in Montréal", () => {
    const doc = { mimeType: "application/pdf", text: LEASE, content: pdf(10) };
    expect(
      runInputs({ studio: "compliance-check", jurisdiction: "QC" }, doc, new Date("2026-10-24T01:30:00Z")),
    ).toMatchObject({ asOf: "2026-10-23" });
    expect(
      runInputs({ studio: "compliance-check", jurisdiction: "QC" }, doc, new Date("2026-10-24T12:00:00Z")),
    ).toMatchObject({ asOf: "2026-10-24" });
  });
  it("sends the PDF itself, in base64, to the authenticity Studio — and the expected issuer when given", () => {
    const content = pdf(4);
    expect(
      runInputs(
        { studio: "document-authenticity", expectedIssuer: "Agence Dupont" },
        { mimeType: "application/pdf", text: "", content },
      ),
    ).toEqual({ documentBase64: content.toString("base64"), expectedIssuer: "Agence Dupont" });
  });
  it("refuses what a Studio cannot read, before calling Sovkora", () => {
    expect(() =>
      runInputs(
        { studio: "compliance-check", jurisdiction: "FR" },
        { mimeType: "application/pdf", text: "  ", content: pdf(1) },
      ),
    ).toThrow(/no text layer/);
    expect(() =>
      runInputs(
        { studio: "compliance-check", jurisdiction: "FR" },
        { mimeType: "text/plain", text: "a".repeat(60_001), content: Buffer.from("a") },
      ),
    ).toThrow(/longer/);
    expect(() =>
      runInputs({ studio: "document-authenticity" }, { mimeType: "text/plain", text: "x", content: Buffer.from("x") }),
    ).toThrow(/PDF and Word files/);
    // A Word file is examined as a file too (verikora#229, document-authenticity 1.3.0).
    const word = Buffer.from("PK\u0003\u0004 word");
    expect(runInputs({ studio: "document-authenticity" }, { mimeType: DOCX_MIME, text: "", content: word })).toEqual({
      documentBase64: word.toString("base64"),
    });
    expect(() =>
      runInputs(
        { studio: "document-authenticity" },
        { mimeType: "application/pdf", text: "", content: pdf(5_000_001) },
      ),
    ).toThrow(/5 MB/);
  });
});

describe("reports", () => {
  const compliance = {
    rulesetId: "fr-residential-lease",
    rulesetVersion: "2026-07-01",
    jurisdiction: "FR",
    asOf: "2026-10-14",
    findings: [
      {
        ruleId: "FR-LEASE-005",
        title: "Dépôt plafonné",
        severity: "BLOCKING",
        verdict: "FAIL",
        evidenceSpan: { quote: "Dépôt de garantie : 2 550 €" },
        explanation: "Excède un mois.",
        citation: "Loi 89-462, art. 22",
      },
    ],
  };
  it("asks for attention on a failed blocking rule or an incoherent signal — never on its own judgement", () => {
    expect(needsAttention(compliance)).toBe(true);
    expect(needsAttention({ ...compliance, findings: [{ ...compliance.findings[0]!, verdict: "PASS" }] })).toBe(false);
    expect(needsAttention({ signals: [{ signalId: "PDF-META-002", level: "incohérent", observation: "…" }] })).toBe(
      true,
    );
    expect(needsAttention({ signals: [{ signalId: "PDF-META-001", level: "observé", observation: "…" }] })).toBe(false);
    expect(needsAttention(null)).toBe(false);
  });
  it("makes the findings searchable: rule, explanation, passage, citation", () => {
    const text = searchText(compliance);
    for (const word of ["FR-LEASE-005", "Excède un mois.", "Dépôt de garantie : 2 550 €", "art. 22"])
      expect(text).toContain(word);
  });
  it("derives a document's state from its latest analyses", () => {
    expect(documentStatus([])).toBe("stored");
    expect(
      documentStatus([
        { status: "running", attention: false },
        { status: "succeeded", attention: true },
      ]),
    ).toBe("analysing");
    expect(documentStatus([{ status: "succeeded", attention: true }])).toBe("attention");
    expect(
      documentStatus([
        { status: "succeeded", attention: false },
        { status: "failed", attention: false },
      ]),
    ).toBe("checked");
    expect(documentStatus([{ status: "failed", attention: false }])).toBe("failed");
  });
});

describe("uploads", () => {
  it("takes a PDF by its first bytes, a text file by its name, and nothing else", async () => {
    const pdfBytes = await cleanPdf();
    expect(await checkUpload({ name: "bail.pdf", type: "application/octet-stream", size: 20 }, pdfBytes)).toMatchObject(
      { mimeType: "application/pdf", pages: 1 },
    );
    expect(await checkUpload({ name: "notes.txt", type: "", size: 3 }, Buffer.from("abc"))).toMatchObject({
      mimeType: "text/plain",
    });
    await expect(
      checkUpload({ name: "x.pdf", type: "application/pdf", size: 3 }, Buffer.from("MZ\u0090")),
    ).rejects.toMatchObject({ body: { code: "FILE_EXECUTABLE", reason: "EXECUTABLE" } });
    await expect(
      checkUpload({ name: "x.txt", type: "text/plain", size: 2 }, Buffer.from([0x41, 0x00])),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      checkUpload({ name: "x.pdf", type: "application/pdf", size: 0 }, Buffer.alloc(0)),
    ).rejects.toMatchObject({ body: { code: "EMPTY_FILE" } });
    await expect(
      checkUpload({ name: "x.pdf", type: "application/pdf", size: 1 }, new Uint8Array(10 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("names a document after its file, safely", () => {
    expect(titleOf("bail_2026-appartement.pdf")).toBe("bail 2026 appartement");
    expect(safeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeFilename("Facture n°12 (copie).pdf")).toBe("Facture n_12 _copie_.pdf");
  });
  it("keeps a PDF's lines, drops its layout spaces", () => {
    expect(normaliseText("Loyer   mensuel :\t850 €\r\n\n\n\nFin ")).toBe("Loyer mensuel : 850 €\n\nFin");
  });
});

describe("search", () => {
  it("escapes everything but the markers around a match", () => {
    expect(passageHtml("le \u0002dépôt\u0003 <script>alert(1)</script> & co")).toBe(
      "le <b>dépôt</b> &lt;script&gt;alert(1)&lt;/script&gt; &amp; co",
    );
  });
  it("cleans the query", () => {
    expect(normaliseQuery("  dépôt\u0000 garantie ")).toBe("dépôt  garantie");
    expect(normaliseQuery("x".repeat(500))).toHaveLength(200);
  });
});
