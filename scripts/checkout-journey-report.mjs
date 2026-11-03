#!/usr/bin/env node
// The issue a red checkout journey on main files, written to a file for `krizaka/.github/actions/alert-issue` (krizaka-internal#2267):
// the alert lives in the private krizaka-internal, with the org app token; this repository is public and opens no issue of its own.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { issueFor } from "./checkout-journey-lib.mjs";

/** The issue (title and body) from the workflow's environment. Pure. */
export function reportFor(env) {
  const {
    GITHUB_SERVER_URL: server,
    GITHUB_REPOSITORY: repo,
    GITHUB_RUN_ID: runId,
    GITHUB_SHA: sha,
    JOURNEY_FAILURE: failure,
  } = env;
  return issueFor({ runUrl: `${server}/${repo}/actions/runs/${runId}`, sha, failure });
}

/** The report's path, resolved inside `base` (the runner's temporary folder); a path that leaves it throws. Pure. */
export function reportPath(arg, base) {
  const path = resolve(base, arg);
  const rel = relative(resolve(base), path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`the report path ${arg} is outside ${base}`);
  }
  return path;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (out) {
    writeFileSync(reportPath(out, process.env.RUNNER_TEMP ?? tmpdir()), reportFor(process.env).body);
  } else {
    console.error("usage: checkout-journey-report.mjs <body-file>");
    process.exitCode = 2;
  }
}
