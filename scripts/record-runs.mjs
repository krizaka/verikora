#!/usr/bin/env node
// Records the real runs the home's proof shows (the tenant's lease; the landlord's template is kept beside it), through Sovkora's compliance Studio
// (the Québec ruleset), exactly as Sovkora returns them — run id, Studio version, the outputs verbatim. Nothing is typed
// by hand: the files under apps/web/content/recorded-runs/ are this script's output, and a test refuses a page without one.
//
//   AI_API_URL=https://dev.sovkora.com/edge AI_API_KEY=oz_… node scripts/record-runs.mjs [tenant|landlord …]
//
// The key is read from the environment (never printed); the Studio is the one Verikora itself calls (lib/sovkora.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { localDay } from "@krizaka/intl";

import { runToEnd, sovkoraClient } from "./lib/sovkora-recording.mjs";
import { SAMPLES } from "../apps/web/content/recorded-runs/samples.mjs";

// The calendar day of the law (apps/web/lib/rulesets.ts LAW_TIME_ZONE), never the UTC day (verikora#309).
const LAW_TIME_ZONE = "America/Toronto";

const client = sovkoraClient();
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../apps/web/content/recorded-runs");
const { base, studio: STUDIO, call } = client;

const installed = await call("/api/v1/studios/installations");
if (!installed.some((i) => i.studioKey === STUDIO))
  await call(`/api/v1/studios/${STUDIO}/installations?locale=en`, { method: "POST", body: { config: {} } });

const wanted = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const [side, sample] of Object.entries(SAMPLES)) {
  if (wanted.length && !wanted.includes(side)) continue;
  // A sample may name a ruleset of the Studio besides the jurisdiction's lease (the Québec invoice: pack 1.3.0).
  const inputs = {
    document: sample.text,
    jurisdiction: "QC",
    asOf: localDay(new Date(), LAW_TIME_ZONE),
    ...(sample.ruleset ? { ruleset: sample.ruleset } : {}),
  };
  const run = await runToEnd(client, inputs, side);
  const recording = {
    side,
    recordedAt: new Date().toISOString(),
    source: base,
    studio: STUDIO,
    document: { title: sample.title, filename: sample.filename, text: sample.text },
    inputs: {
      jurisdiction: inputs.jurisdiction,
      asOf: inputs.asOf,
      ...(inputs.ruleset ? { ruleset: inputs.ruleset } : {}),
    },
    run, // exactly as Sovkora returned it (id, status, blueprintVersion, outputs, dates)
  };
  writeFileSync(join(OUT, `${side}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`${side}: run ${run.id} (${run.status}) recorded`);
}
