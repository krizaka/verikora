import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { buildDocument, DEFAULT_SEED, SPECS } from "./catalogue.mjs";
import { renderPdf } from "./render.mjs";

export { AS_OF, DEFAULT_SEED, PERSONA_DEMO_LANDLORD, PERSONA_ERIC, SPECS } from "./catalogue.mjs";
export { WATERMARK } from "./render.mjs";

/** One document: its PDF bytes, its text (what a check reads), the findings it is expected to give. */
export async function generateDocument(id, seed = DEFAULT_SEED) {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`no such demo document: ${id}`);
  const doc = buildDocument(spec, seed);
  const { bytes, pages } = await renderPdf(doc.title, doc.lines);
  return { ...doc, text: doc.lines.join("\n"), pages, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function generateAll(seed = DEFAULT_SEED) {
  const out = [];
  for (const spec of SPECS) out.push(await generateDocument(spec.id, seed));
  return out;
}

/** Writes the PDFs and `findings.json` (the expected findings of each variant) into a directory. */
export async function writeAll(dir, seed = DEFAULT_SEED) {
  await mkdir(dir, { recursive: true });
  const all = await generateAll(seed);
  for (const doc of all) await writeFile(join(dir, doc.filename), doc.bytes);
  const manifest = all.map(({ id, filename, family, kind, flaw, title, sha256, findings }) => ({
    id,
    filename,
    family,
    kind,
    flaw,
    title,
    sha256,
    findings,
  }));
  await writeFile(join(dir, "findings.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return all;
}
