import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { reportLabels } from "./report-labels";
import { ATTESTATION_KEY, attestationOfPdf, verifyPdf } from "./report-pdf";
import { signingKey } from "./report-signer";
import { sampleReportPdf } from "./sample-report";

const FIXTURES = join(__dirname, "../../../fixtures/sample-file");
const recording = JSON.parse(readFileSync(join(FIXTURES, "recorded-run.json"), "utf8"));
const lease = new Uint8Array(readFileSync(join(FIXTURES, "documents/bail-4-et-demi-rue-des-fictifs.pdf")));

/** The text of each page of a PDF, whitespace collapsed. */
async function pagesOf(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  return (text as string[]).map((t) => t.replace(/\s+/g, " "));
}

describe("the sample report of krizaka-internal#3119", () => {
  it("is a real Sovkora run, kept as returned, on the sample file's lease", () => {
    expect(recording.run.status).toBe("SUCCEEDED");
    expect(recording.run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(recording.document.text).toContain("Rosalie Modèle-Bergeron (fictif)");
  });

  for (const lang of ["fr", "en"] as const) {
    describe(lang, () => {
      it("verifies with the development key, and carries the lease's own hash and the run id", async () => {
        const issued = await sampleReportPdf(recording, lease, lang);
        const verified = await verifyPdf(issued.bytes, signingKey());
        expect(verified).toMatchObject({ ok: true });
        expect(issued.attestation.payload.demo).toBe(true);
        expect(issued.attestation.payload.check.runId).toBe(recording.run.id);
        expect(await verifyPdf(issued.bytes, signingKey(), lease)).toMatchObject({ ok: true, documentMatch: true });
      });

      it("says on its first page « fictitious file » and « development version »", async () => {
        const issued = await sampleReportPdf(recording, lease, lang);
        const labels = reportLabels(lang);
        const first = (await pagesOf(issued.bytes))[0]!;
        expect(labels.demoFile).toBe(
          lang === "fr" ? "Dossier fictif — démonstration" : "Fictitious file — demonstration",
        );
        expect(labels.demoVersion).toBe(lang === "fr" ? "Version de développement" : "Development version");
        expect(first).toContain(labels.demoFile);
        expect(first).toContain(labels.demoVersion);
        // They come first, before the report's own eyebrow.
        expect(first.indexOf(labels.demoFile!)).toBeLessThan(first.indexOf(labels.eyebrow!));
      });

      it("keeps the section « what this check is not », and says what was found", async () => {
        const issued = await sampleReportPdf(recording, lease, lang);
        const text = (await pagesOf(issued.bytes)).join(" ");
        expect(text).toContain(reportLabels(lang).guaranteeHeading);
        expect(text).toContain(reportLabels(lang).notGuaranteed);
        expect(issued.attestation.payload.findings.length).toBeGreaterThan(0);
        expect(issued.attestation.payload.findings.some((f) => f.verdict === "FAIL")).toBe(true);
      });
    });
  }

  it("a word changed in the signed text, or the flag removed, no longer verifies", async () => {
    const issued = await sampleReportPdf(recording, lease, "fr");
    const attestation = (await attestationOfPdf(issued.bytes))!;
    // Dropping the demo flag from the payload breaks the signature: the labels cannot be taken off.
    const rest = { ...attestation.payload, demo: undefined };
    const doc = await PDFDocument.load(issued.bytes, { updateMetadata: false });
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    info.set(
      PDFName.of(ATTESTATION_KEY),
      PDFString.of(Buffer.from(JSON.stringify({ ...attestation, payload: rest }), "utf8").toString("base64")),
    );
    expect(await verifyPdf(await doc.save(), signingKey())).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("is the same bytes every time (the file can be regenerated and compared)", async () => {
    const a = await sampleReportPdf(recording, lease, "fr");
    const b = await sampleReportPdf(recording, lease, "fr");
    expect(a.fileSha256).toBe(b.fileSha256);
  });

  // `pnpm sample:report` runs this file with SAMPLE_REPORT_OUT set: the same code writes the files the founder sends.
  it.skipIf(!process.env.SAMPLE_REPORT_OUT)("writes the signed PDFs to SAMPLE_REPORT_OUT", async () => {
    const dir = process.env.SAMPLE_REPORT_OUT!;
    mkdirSync(dir, { recursive: true });
    for (const lang of ["fr", "en"] as const) {
      const issued = await sampleReportPdf(recording, lease, lang);
      writeFileSync(join(dir, `verikora-sample-report-${lang}.pdf`), issued.bytes);
      console.log(`sample-report: verikora-sample-report-${lang}.pdf sha256 ${issued.fileSha256}`);
    }
  });
});
