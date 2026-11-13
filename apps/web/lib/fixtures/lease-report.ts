import { PDFDocument, StandardFonts } from "pdf-lib";

import recorded from "./sovkora-compliance-qc-1.2.0.json";

/**
 * The recorded compliance report the integration tests' fake Sovkora answers with, and the lease text it quotes. The report is read under the
 * contract of krizaka-internal#3378: every passage it cites must be in the stored text, so a test's lease PDF carries those passages (`leasePdf`).
 */
export const LEASE_REPORT = JSON.stringify(recorded);

const report = recorded as { findings: { evidenceSpan?: { quote: string } | null }[] };

/** The passages the recorded report cites. */
export const LEASE_QUOTES = report.findings.flatMap((f) => (f.evidenceSpan ? [f.evidenceSpan.quote] : []));

/** A lease's lines: a label that makes it a distinct file, then every passage the recorded report cites, one per line (a line past the page's edge is not read back). */
export const leaseLines = (label: string) => [`BAIL ${label}`, ...LEASE_QUOTES];

/** A lease PDF whose text holds what the recorded report cites. */
export async function leasePdf(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  leaseLines(label).forEach((line, i) => page.drawText(line, { x: 40, y: 760 - i * 20, size: 10, font }));
  doc.setProducer("Fixture");
  doc.setCreator("Fixture");
  return doc.save({ useObjectStreams: false });
}
