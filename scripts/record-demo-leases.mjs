#!/usr/bin/env node
// Records the real runs of the Québec lease pack on the two fictitious lease fixtures of the demo generator (issue #302),
// exactly as Sovkora returns them: run id, Studio version, outputs verbatim. Output: apps/web/content/demo-lease-runs/.
//
//   AI_API_KEY=$(~/.krizaka-worktrees/tools/secret.sh @verikora AI_API_KEY) node scripts/record-demo-leases.mjs
//
// The key is read from the environment and never printed or written. The document is the generator's text, the same
// words the check reads from the PDF's text layer.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateDocument } from "./demo-documents/index.mjs";
import { runToEnd, sovkoraClient } from "./lib/sovkora-recording.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../apps/web/content/demo-lease-runs");
const client = sovkoraClient();
const { base, studio: STUDIO } = client;
const CASES = [
  { name: "clean", id: "bail-rosemont-1-conforme" },
  { name: "errors", id: "bail-rosemont-5-clause-illegale" },
];

mkdirSync(OUT, { recursive: true });
for (const c of CASES) {
  const doc = await generateDocument(c.id);
  const inputs = { document: doc.text, jurisdiction: "QC", asOf: "2026-10-23" };
  const run = await runToEnd(client, inputs, c.id);
  const recording = {
    recordedAt: new Date().toISOString(),
    source: base,
    studio: STUDIO,
    generator: { id: c.id, seed: 20261023 },
    document: { title: doc.title, language: "fr", text: doc.text },
    inputs: { jurisdiction: "QC", asOf: "2026-10-23" },
    run,
  };
  writeFileSync(join(OUT, `${c.name}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`${c.name}: run ${run.id} (${run.status}) recorded`);
}
