// Runs the REAL check on the sample file's lease through Sovkora's compliance Studio (the Québec ruleset) and keeps the answer exactly as
// Sovkora returned it in fixtures/sample-file/recorded-run.json (krizaka-internal#3119). The key is read from the environment, never printed.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { localDay } from "@krizaka/intl";

import { OUT } from "./build.mjs";
import { DOCUMENTS } from "./documents.mjs";

const LAW_TIME_ZONE = "America/Toronto"; // lib/rulesets.ts: the calendar day of the law
const STUDIO = "compliance-check";
const DONE = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
// The engine is the one dev Studio, fixed here: the check is never sent to an address taken from the environment.
const SOVKORA_DEV = "https://dev.sovkora.com/edge";
const RUN_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export async function recordSampleRun({ key = process.env.AI_API_KEY } = {}) {
  if (!key)
    throw new Error("AI_API_KEY is not set — without it, the recorded run in fixtures/sample-file is used as it is");
  const root = SOVKORA_DEV;
  const call = async (path, init = {}) => {
    const url = new URL(`${root}${path}`);
    if (url.origin !== new URL(SOVKORA_DEV).origin) throw new Error("the check only goes to Sovkora's dev engine");
    const res = await fetch(url, {
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
  };
  const installed = await call("/api/v1/studios/installations");
  if (!installed.some((i) => i.studioKey === STUDIO))
    await call(`/api/v1/studios/${STUDIO}/installations?locale=en`, { method: "POST", body: { config: {} } });

  const lease = DOCUMENTS.find((d) => d.checked === STUDIO);
  const inputs = { document: lease.lines.join("\n"), jurisdiction: "QC", asOf: localDay(new Date(), LAW_TIME_ZONE) };
  let run = await call(`/api/v1/studios/${STUDIO}/runs`, { method: "POST", body: { inputs } });
  for (let i = 0; i < 90 && !DONE.has(run.status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const id = RUN_ID.exec(String(run.id))?.[0];
    if (!id) throw new Error("Sovkora returned a run id of an unexpected shape");
    run = await call(`/api/v1/studios/runs/${id}`);
  }
  if (run.status !== "SUCCEEDED") throw new Error(`the run ended ${run.status}`);
  const recording = {
    side: "tenant",
    recordedAt: new Date().toISOString(),
    source: root,
    studio: STUDIO,
    document: { title: lease.title, filename: lease.filename, text: inputs.document },
    inputs: { jurisdiction: inputs.jurisdiction, asOf: inputs.asOf },
    run, // exactly as Sovkora returned it
  };
  writeFileSync(join(OUT, "recorded-run.json"), `${JSON.stringify(recording, null, 2)}\n`);
  return run;
}
