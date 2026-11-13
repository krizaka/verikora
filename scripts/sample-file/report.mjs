#!/usr/bin/env node
// `pnpm sample:report [--record]` — the signed sample report, FR and EN, written to fixtures/sample-file/out/ (git-ignored, never committed).
//   --record  runs the real check on Sovkora (dev) first (AI_API_KEY in the environment) and keeps its answer;
//             without it the recorded run already in fixtures/sample-file/recorded-run.json is signed (dev is not needed, same bytes every time).
// The signing is TypeScript (apps/web/lib/sample-report.ts), run by the web app's own test runner: no second loader to keep.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { OUT } from "./build.mjs";
import { recordSampleRun } from "./record.mjs";

if (process.argv.includes("--record")) {
  await recordSampleRun();
  console.log("sample-report: the real check ran on Sovkora (dev) and its answer is recorded in recorded-run.json");
} else {
  console.log(
    "sample-report: using the recorded run (fixtures/sample-file/recorded-run.json); --record runs the check again on dev",
  );
}
const out = join(OUT, "out");
const web = new URL("../../apps/web/", import.meta.url).pathname;
const vitest = join(dirname(createRequire(join(web, "package.json")).resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "--project", "unit", "lib/sample-report.test.ts"], {
  cwd: web,
  stdio: "inherit",
  env: { ...process.env, SAMPLE_REPORT_OUT: out },
});
if (result.status === 0) console.log("sample-report: the signed PDFs are in fixtures/sample-file/out/");
process.exit(result.status ?? 1);
