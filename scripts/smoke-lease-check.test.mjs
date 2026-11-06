import assert from "node:assert/strict";
import { test } from "vitest";

import { describeFailure, leaseRefOn, montrealDay, smokeLeaseCheck } from "./smoke-lease-check.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A Verikora that answers like the real one; `refuse` makes the check start answer a refusal. */
function fakeVerikora({
  refuse = false,
  report = { findings: [{ ruleId: "QC-001" }], facts: { rentCents: { status: "found", cents: 122500 } } },
} = {}) {
  const seen = [];
  const impl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    seen.push(`${init.method ?? "GET"} ${pathname}`);
    if (pathname === "/api/auth/sign-in") return json(200, { account: { email: "p@example.com" }, token: "t" });
    if (pathname === "/api/documents" && init.method === "POST")
      return json(202, { document: { id: "d1" }, status: "QUEUED" });
    if (pathname === "/api/documents/d1" && init.method === "DELETE") return json(200, {});
    if (pathname === "/api/documents/d1" && init.method === "POST") {
      seen.push(JSON.parse(init.body));
      return refuse
        ? json(422, { code: "SOVKORA_INPUT" })
        : json(202, { analysis: { id: "a1", status: "running", runId: "r1" } });
    }
    if (pathname === "/api/documents/d1") return json(200, { document: { extraction: "done" } });
    if (pathname === "/api/documents/d1/analyses/a1")
      return json(200, { analysis: { id: "a1", status: "succeeded", runId: "r1", report } });
    return json(404, {});
  };
  return { impl, seen };
}
const options = (extra) => ({
  base: "https://dev.example",
  email: "p@example.com",
  password: "x",
  wait: async () => {},
  now: () => new Date("2026-10-29T15:00:00Z"),
  ...extra,
});

test("the lease version is the one in force in Montréal", () => {
  assert.equal(leaseRefOn("2026-05-01"), "qc-residential-lease/2024-02-21");
  assert.equal(leaseRefOn("2026-10-29"), "qc-residential-lease/2026-10-24");
  assert.equal(montrealDay(new Date("2026-10-24T01:30:00Z")), "2026-10-23");
});

test("a refusal of the engine fails the smoke with the code, and the document is still deleted", async () => {
  const { impl, seen } = fakeVerikora({ refuse: true });
  await assert.rejects(smokeLeaseCheck(options({ fetchImpl: impl })), /start the lease check: HTTP 422, SOVKORA_INPUT/);
  assert.ok(seen.includes("DELETE /api/documents/d1"));
});

test("a lease that is checked passes, and the request is the UI's", async () => {
  const { impl, seen } = fakeVerikora();
  const result = await smokeLeaseCheck(options({ fetchImpl: impl }));
  assert.deepEqual(result, { analysisId: "a1", runId: "r1", findings: 1, facts: ["rentCents"] });
  assert.deepEqual(
    seen.find((s) => typeof s === "object"),
    { studio: "compliance-check", jurisdiction: "QC", ruleset: "qc-residential-lease/2026-10-24", asOf: "2026-10-29" },
  );
});

test("a report with no findings fails", async () => {
  const { impl } = fakeVerikora({ report: {} });
  await assert.rejects(smokeLeaseCheck(options({ fetchImpl: impl })), /without a report with findings/);
});

test("a failure is described by its status and code, never its body", () => {
  assert.equal(
    describeFailure("sign-in", 401, { code: "BAD_CREDENTIALS", message: "secret detail" }),
    "sign-in: HTTP 401, BAD_CREDENTIALS",
  );
});

test("a printed line has no line break an input could forge", async () => {
  const { plain } = await import("./smoke-lease-check.mjs");
  assert.equal(plain("a\nb\r\nc"), "a b  c");
});
