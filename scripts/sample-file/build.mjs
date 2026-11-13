#!/usr/bin/env node
// Writes the sample applicant file (fixtures/sample-file/documents/*.pdf and provenance.json). Deterministic: the same bytes every run.
//   node scripts/sample-file/build.mjs [--check]     --check writes nothing and fails if the committed files differ
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderPdf } from "../demo-documents/render.mjs";
import { APPLICANT, AS_OF, DOCUMENTS, EMPLOYER, LANDLORD } from "./documents.mjs";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/sample-file");

/** The PDFs and the provenance record, as bytes (nothing written). */
export async function buildSampleFile() {
  const files = [];
  for (const d of DOCUMENTS) {
    const { bytes, pages } = await renderPdf(d.title, d.lines);
    files.push({ ...d, bytes, pages, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const provenance = {
    fictitious: true,
    asOf: AS_OF,
    purpose:
      "Sample applicant file for the signed report a manager receives when they ask for one (krizaka-internal#3119).",
    persona: {
      applicant: APPLICANT,
      landlord: LANDLORD,
      employer: EMPLOYER,
      bank: "Banque Imaginaire du Québec (fictive)",
    },
    noRealPerson:
      "Every person, employer, bank and address is invented. Surnames carry a marker word, postal codes use the letter D (never issued), the SIN-like number starts with 0 and is invalid.",
    madeBy:
      "node scripts/sample-file/build.mjs — the text is scripts/sample-file/documents.mjs, rendered by scripts/demo-documents/render.mjs (pdf-lib, fixed dates).",
    documents: files.map(({ id, filename, title, sha256, pages, checked }) => ({
      id,
      filename: `documents/${filename}`,
      title,
      sha256,
      pages,
      how: "Written by hand as data, rendered to a text PDF with every page stamped « SPÉCIMEN — document fictif ».",
      checkedBy: checked,
    })),
  };
  return { files, provenance: `${JSON.stringify(provenance, null, 2)}\n` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, provenance } = await buildSampleFile();
  if (process.argv.includes("--check")) {
    const stale = files.filter(
      (f) => Buffer.compare(readFileSync(join(OUT, "documents", f.filename)), Buffer.from(f.bytes)) !== 0,
    );
    if (stale.length || readFileSync(join(OUT, "provenance.json"), "utf8") !== provenance) {
      console.error("sample-file: the committed fixtures differ from the generator — run `pnpm sample:file`");
      process.exit(1);
    }
    console.log("sample-file: the fixtures match the generator");
  } else {
    mkdirSync(join(OUT, "documents"), { recursive: true });
    for (const f of files) writeFileSync(join(OUT, "documents", f.filename), f.bytes);
    writeFileSync(join(OUT, "provenance.json"), provenance);
    console.log(`sample-file: ${files.length} fictitious PDFs and provenance.json written to ${OUT}`);
  }
}
