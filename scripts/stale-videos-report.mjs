#!/usr/bin/env node
// Reads the download page's manifest, writes the alert body to the file given and the state (`red` | `green`) to the step's output, for
// `krizaka/.github/actions/alert-issue` (`.github/workflows/stale-videos.yml`, krizaka-internal#3626).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { reportPath } from "./checkout-journey-report.mjs";
import { alertFor } from "./stale-videos-lib.mjs";

const MANIFEST = new URL("../apps/web/content/app-videos.json", import.meta.url);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: stale-videos-report.mjs <body-file>");
    process.exit(2);
  }
  const { videos } = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const {
    GITHUB_SERVER_URL: server,
    GITHUB_REPOSITORY: repo,
    GITHUB_RUN_ID: runId,
    GITHUB_OUTPUT: output,
  } = process.env;
  const alert = alertFor(new Date(), videos, runId ? `${server}/${repo}/actions/runs/${runId}` : "");
  // The path is resolved inside the runner's temporary folder; one that leaves it throws (as the checkout journey's report does).
  writeFileSync(reportPath(out, process.env.RUNNER_TEMP ?? tmpdir()), alert.body);
  if (output) appendFileSync(output, `state=${alert.state}\n`);
  console.log(`${alert.state}: ${alert.ids.length ? alert.ids.join(", ") : "no stale recording"}`);
}
