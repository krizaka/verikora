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

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../apps/web/content/demo-lease-runs");
const base = (process.env.AI_API_URL ?? "https://dev.sovkora.com/edge").replace(/\/$/, "");
const key = process.env.AI_API_KEY;
if (!key) throw new Error("AI_API_KEY is not set");
const STUDIO = "compliance-check";
const CASES = [
  { name: "clean", id: "bail-rosemont-1-conforme" },
  { name: "errors", id: "bail-rosemont-5-clause-illegale" },
];

async function call(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`Sovkora answered ${res.status} on ${init.method ?? "GET"} ${path.split("?")[0]}`);
  return res.json();
}

mkdirSync(OUT, { recursive: true });
for (const c of CASES) {
  const doc = await generateDocument(c.id);
  const inputs = { document: doc.text, jurisdiction: "QC", asOf: "2026-10-23" };
  let run = await call(`/api/v1/studios/${STUDIO}/runs`, { method: "POST", body: { inputs } });
  for (let i = 0; i < 90 && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    run = await call(`/api/v1/studios/runs/${run.id}`);
  }
  if (run.status !== "SUCCEEDED") throw new Error(`${c.id}: the run ${run.id} ended ${run.status}`);
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
