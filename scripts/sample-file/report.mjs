#!/usr/bin/env node
// `pnpm sample:report [--record]` — the signed sample report, FR and EN, written to fixtures/sample-file/out/ (git-ignored, never committed).
//   --record  runs the real check on Sovkora (dev) first (AI_API_URL / AI_API_KEY in the environment) and keeps its answer;
//             without it the recorded run already in fixtures/sample-file/recorded-run.json is signed (dev is not needed, same bytes every time).
// The signing is TypeScript (apps/web/lib/sample-report.ts), run by the web app's own test runner: no second loader to keep.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { OUT } from "./build.mjs";
import { recordSampleRun } from "./record.mjs";

if (process.argv.includes("--record")) {
  const run = await recordSampleRun();
  console.log(`sample-report: real run ${run.id} on Sovkora (${run.status}), recorded`);
} else {
  console.log(
    "sample-report: using the recorded run (fixtures/sample-file/recorded-run.json); --record runs the check again on dev",
  );
}
const out = join(OUT, "out");
const result = spawnSync(
  "pnpm",
  ["--filter", "@verikora/web", "exec", "vitest", "run", "--project", "unit", "lib/sample-report.test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, SAMPLE_REPORT_OUT: out },
  },
);
if (result.status === 0) console.log(`sample-report: written to ${out}`);
process.exit(result.status ?? 1);
