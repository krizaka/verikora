#!/usr/bin/env node
// MANUAL TOOL (ADR-026), run by a person; owner: verikora lane; listed in README.md « Manual tools »; the header below says how to run it.
// Records one real Sovkora run per Québec ruleset on a whole demo document (sovkora-packs `document-validation`
// fixtures), exactly as Sovkora returns it — run id, Studio version, outputs verbatim. Output: apps/web/content/pack-proofs/.
//
//   AI_API_URL=https://dev.sovkora.com/edge AI_API_KEY=oz_… node scripts/record-packs.mjs <sovkora-packs/document-validation/worker/fixtures>
//
// Never typed by hand; the key is read from the environment and never printed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { localDay } from "@krizaka/intl";

// The calendar day of the law (apps/web/lib/rulesets.ts LAW_TIME_ZONE), never the UTC day (verikora#309).
const LAW_TIME_ZONE = "America/Toronto";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../apps/web/content/pack-proofs");
const base = (process.env.AI_API_URL ?? "https://dev.sovkora.com/edge").replace(/\/$/, "");
const key = process.env.AI_API_KEY;
if (!key) throw new Error("AI_API_KEY is not set");
const fixtures = resolve(process.argv[2] ?? "");
const STUDIO = "compliance-check";

/** One proof per document: `<ruleset>--<fixture>`. The lease is the default ruleset of Québec; the others are named. */
const CASES = [
  {
    ruleset: "qc-residential-lease",
    file: "qc-residential-lease/fr-compliant.txt",
    title: "Bail de logement — 3½, avenue du Parc (démonstration)",
    lang: "fr",
  },
  {
    ruleset: "qc-residential-lease",
    file: "qc-residential-lease/fr-defective.txt",
    title: "Bail de logement — 12 mois, dépôt et chèques postdatés (démonstration)",
    lang: "fr",
  },
  {
    ruleset: "qc-invoice",
    file: "qc-invoice/krizaka-bilingual-aligned.txt",
    title: "Facture bilingue — modèle Krizaka (démonstration)",
    lang: "fr-en",
  },
  {
    ruleset: "qc-service-contract",
    file: "qc-service-contract/fr-compliant.txt",
    title: "Contrat de services — Studio Nordik (démonstration)",
    lang: "fr",
  },
  {
    ruleset: "qc-service-contract",
    file: "qc-service-contract/en-defective.txt",
    title: "Services agreement — website build (demonstration)",
    lang: "en",
  },
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
  const text = readFileSync(join(fixtures, c.file), "utf8");
  const inputs = {
    document: text,
    jurisdiction: "QC",
    asOf: localDay(new Date(), LAW_TIME_ZONE),
    ...(c.ruleset === "qc-residential-lease" ? {} : { ruleset: c.ruleset }),
  };
  let run = await call(`/api/v1/studios/${STUDIO}/runs`, { method: "POST", body: { inputs } });
  for (let i = 0; i < 90 && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    run = await call(`/api/v1/studios/runs/${run.id}`);
  }
  if (run.status !== "SUCCEEDED") throw new Error(`${c.file}: the run ${run.id} ended ${run.status}`);
  const name = `${c.ruleset}--${c.file.split("/")[1].replace(/\.txt$/, "")}`;
  const recording = {
    ruleset: c.ruleset,
    recordedAt: new Date().toISOString(),
    source: base,
    studio: STUDIO,
    document: { title: c.title, language: c.lang, filename: c.file.split("/")[1], text },
    inputs: {
      jurisdiction: inputs.jurisdiction,
      asOf: inputs.asOf,
      ...(inputs.ruleset ? { ruleset: inputs.ruleset } : {}),
    },
    run,
  };
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`${name}: run ${run.id} (${run.status}) recorded`);
}
