#!/usr/bin/env node
// The post-deploy smoke of the lease check (verikora P0, 2026-10-29: « Sovkora refused the document as sent » on dev for a lease while
// every unit test was green, because no test crossed the real Sovkora). ONE real lease check on a deployed Verikora, as a persona:
//   sign in ONCE (bearer) -> upload the demo lease -> wait for its text -> start the compliance check the way the UI does -> wait for the
//   report -> delete the document. It fails, with the code Verikora answered (never a secret), if the engine refuses or the report is empty.
//
//   SMOKE_EMAIL=… SMOKE_PASSWORD=… node scripts/smoke-lease-check.mjs --base https://dev.verikora.com
import { fileURLToPath } from "node:url";

import { generateDocument } from "./demo-documents/index.mjs";

/** The Québec lease versions the UI asks for (apps/web/lib/rulesets.ts; apps/web/lib/sovkora-contract.test.ts keeps them equal). */
export const LEASE_REFS = [
  { effectiveFrom: null, ref: "qc-residential-lease/2024-02-21" },
  { effectiveFrom: "2026-10-24", ref: "qc-residential-lease/2026-10-24" },
];

/** The lease ruleset in force on a day (yyyy-mm-dd), as the UI picks it. Pure. */
export function leaseRefOn(asOf) {
  let current = null;
  for (const v of LEASE_REFS)
    if (
      (v.effectiveFrom === null || v.effectiveFrom <= asOf) &&
      (current === null || (v.effectiveFrom ?? "") >= (current.effectiveFrom ?? ""))
    )
      current = v;
  return current.ref;
}

/** The day in Montréal (the calendar of the law). Pure. */
export const montrealDay = (now) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What the smoke says for an answer that is not the expected one: the status and the stable code, never the body in full. Behind
 * DigitalOcean a 5xx arrives as the ingress's own page (status 504, no JSON): the status it replaced (`x-do-orig-status`) and the code
 * Verikora also sends as a header (`x-error-code`) still say what happened (krizaka-internal#3214). Pure.
 */
export function describeFailure(step, status, body, headers = new Headers()) {
  const code =
    [body?.code, body?.error?.code, headers.get("x-error-code")].find((c) => typeof c === "string" && c) ?? "no code";
  const origin = headers.get("x-do-orig-status");
  return `${step}: HTTP ${status}${origin && origin !== String(status) ? ` (origin ${origin})` : ""}, ${code}`;
}

/** Waits until the document's text is read (the extraction leaves queued/running), or fails with a stable sentence. */
async function waitForText({ call, token, documentId, deadline, now, wait }) {
  for (;;) {
    const read = await call(`/api/documents/${documentId}`, {}, token);
    if (!read.res.ok)
      throw new Error(describeFailure("read the document", read.res.status, read.body, read.res.headers));
    const extraction = read.body.document.extraction;
    if (extraction === "failed") throw new Error("the text of the lease could not be read");
    if (extraction !== "queued" && extraction !== "running") return;
    if (now().getTime() > deadline) throw new Error("the text of the lease was not read in time");
    await wait(2000);
  }
}

/** Polls the lease check until it is no longer running. */
async function waitForAnalysis({ call, token, documentId, first, deadline, now, wait }) {
  let analysis = first;
  while (analysis.status === "running") {
    if (now().getTime() > deadline) throw new Error("the lease check did not finish in time");
    await wait(3000);
    const poll = await call(`/api/documents/${documentId}/analyses/${analysis.id}`, {}, token);
    if (!poll.res.ok)
      throw new Error(describeFailure("read the lease check", poll.res.status, poll.body, poll.res.headers));
    analysis = poll.body.analysis;
  }
  return analysis;
}

export async function smokeLeaseCheck({
  base,
  email,
  password,
  fetchImpl = fetch,
  now = () => new Date(),
  wait = sleep,
  timeoutMs = 240_000,
  log = () => {},
  onReport = null,
}) {
  if (!email || !password) throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required (the persona)");
  const call = async (path, init = {}, token) => {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
    return { res, body: await res.json().catch(() => null) };
  };
  const signIn = await call("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, client: "native" }),
  });
  if (!signIn.res.ok || typeof signIn.body?.token !== "string")
    throw new Error(describeFailure("sign-in", signIn.res.status, signIn.body, signIn.res.headers));
  const token = signIn.body.token;
  let documentId = null;
  try {
    const lease = await generateDocument("bail-rosemont-1-conforme");
    const form = new FormData();
    form.set("file", new File([lease.bytes], "smoke-bail.pdf", { type: "application/pdf" }));
    form.set("kind", "lease");
    const upload = await call("/api/documents", { method: "POST", body: form }, token);
    if (!upload.res.ok) throw new Error(describeFailure("upload", upload.res.status, upload.body, upload.res.headers));
    documentId = upload.body.document.id;
    log(`uploaded ${documentId}`);
    const deadline = now().getTime() + timeoutMs;
    await waitForText({ call, token, documentId, deadline, now, wait });
    const asOf = montrealDay(now());
    const start = await call(
      `/api/documents/${documentId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studio: "compliance-check", jurisdiction: "QC", ruleset: leaseRefOn(asOf), asOf }),
      },
      token,
    );
    if (!start.res.ok)
      throw new Error(describeFailure("start the lease check", start.res.status, start.body, start.res.headers));
    const analysis = await waitForAnalysis({
      call,
      token,
      documentId,
      first: start.body.analysis,
      deadline,
      now,
      wait,
    });
    const report = analysis.report;
    if (!report || !Array.isArray(report.findings))
      throw new Error("the lease check succeeded without a report with findings");
    if (onReport) await onReport({ base, token, documentId, analysisId: analysis.id });
    return {
      analysisId: analysis.id,
      runId: analysis.runId ?? null,
      findings: report.findings.length,
      facts: report.facts ? Object.keys(report.facts) : [],
    };
  } finally {
    if (documentId) await call(`/api/documents/${documentId}`, { method: "DELETE" }, token).catch(() => {});
  }
}

/** A line safe to print: nothing but printable characters (no line break an input could use to forge a log line). Pure. */
export const plain = (text) => String(text).replace(/[^\x20-\x7E\u00C0-\u017F]/g, " ");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--base");
  const base = (i >= 0 ? process.argv[i + 1] : "https://dev.verikora.com").replace(/\/$/, "");
  try {
    const result = await smokeLeaseCheck({
      base,
      email: process.env.SMOKE_EMAIL,
      password: process.env.SMOKE_PASSWORD,
      log: console.log,
    });
    console.log(
      `lease check on ${plain(base)}: succeeded, ${result.findings} findings, facts [${result.facts.join(", ")}], run ${result.runId}`,
    );
  } catch (error) {
    console.error(`lease check on ${plain(base)} FAILED: ${plain(error.message)}`);
    process.exitCode = 1;
  }
}
