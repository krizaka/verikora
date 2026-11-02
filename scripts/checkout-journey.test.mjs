import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { guard } from "./checkout-journey-guard.mjs";
import {
  assertTestKey,
  decideIssue,
  isHostedCheckout,
  isSignedPdf,
  isSubscribed,
  ISSUE_TITLE,
  issueFor,
  paidReceipt,
  returnedFromCheckout,
  shouldOpenIssue,
} from "./checkout-journey-lib.mjs";

const workflow = readFileSync(new URL("../.github/workflows/checkout-journey.yml", import.meta.url), "utf8");

test("only a TEST processor key is accepted, never a live one", () => {
  const body = "abcdefghij0123456789";
  const ok = ["sk", "test", body].join("_");
  assert.equal(assertTestKey(ok), ok);
  for (const bad of [
    ["sk", "live", body].join("_"),
    ["rk", "test", body].join("_"),
    "sk" + "_test_",
    "",
    undefined,
    null,
  ])
    assert.throws(() => assertTestKey(bad), /test key/);
});

test("the hosted page is Stripe's own and nothing else", () => {
  assert.equal(isHostedCheckout("https://checkout.stripe.com/c/pay/cs_test_1"), true);
  for (const bad of [
    "http://checkout.stripe.com/x",
    "https://checkout.stripe.com.evil.example/x",
    "https://dev.yomizaka.com/pay",
    "not a url",
    undefined,
  ])
    assert.equal(isHostedCheckout(bad), false);
});

test("bought means pro, active and the plan that was sold", () => {
  assert.equal(isSubscribed({ pro: true, subscriptionStatus: "active", planKey: "yomizaka.agency" }), true);
  assert.equal(isSubscribed({ pro: false, subscriptionStatus: "active", planKey: "yomizaka.agency" }), false);
  assert.equal(isSubscribed({ pro: true, subscriptionStatus: "past_due", planKey: "yomizaka.agency" }), false);
  assert.equal(isSubscribed({ pro: true, subscriptionStatus: "active", planKey: "yomizaka.firm" }), false);
  assert.equal(isSubscribed(undefined), false);
});

test("a receipt is a paid row with an https link", () => {
  assert.equal(
    paidReceipt([
      { state: "refunded", receiptUrl: "https://pay.stripe.com/r/1" },
      { state: "paid", receiptUrl: null },
    ]),
    null,
  );
  assert.equal(
    paidReceipt([{ state: "paid", receiptUrl: "https://pay.stripe.com/r/2" }]).receiptUrl,
    "https://pay.stripe.com/r/2",
  );
  assert.equal(paidReceipt(undefined), null);
});

test("a signed report is a PDF with its fingerprint", () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 ...");
  const sha256 = "a".repeat(64);
  assert.equal(isSignedPdf({ contentType: "application/pdf", bytes, sha256 }), true);
  assert.equal(isSignedPdf({ contentType: "text/html", bytes, sha256 }), false);
  assert.equal(
    isSignedPdf({ contentType: "application/pdf", bytes: new TextEncoder().encode("<html>"), sha256 }),
    false,
  );
  assert.equal(isSignedPdf({ contentType: "application/pdf", bytes, sha256: null }), false);
});

test("the guard: a red run on main files an issue, on a pull request or another branch it does not", () => {
  assert.equal(shouldOpenIssue({ eventName: "schedule", ref: "refs/heads/main" }), true);
  assert.equal(shouldOpenIssue({ eventName: "workflow_dispatch", ref: "refs/heads/main" }), true);
  assert.equal(shouldOpenIssue({ eventName: "pull_request", ref: "refs/pull/1/merge" }), false);
  assert.equal(shouldOpenIssue({ eventName: "workflow_dispatch", ref: "refs/heads/feat/x" }), false);
  assert.deepEqual(decideIssue({ eventName: "schedule", ref: "refs/heads/main", openIssues: [] }), {
    action: "create",
  });
  assert.deepEqual(
    decideIssue({ eventName: "schedule", ref: "refs/heads/main", openIssues: [{ number: 7, title: ISSUE_TITLE }] }),
    { action: "comment", number: 7 },
  );
  assert.deepEqual(
    decideIssue({
      eventName: "schedule",
      ref: "refs/heads/main",
      openIssues: [{ number: 8, title: ISSUE_TITLE, pull_request: {} }],
    }),
    { action: "create" },
  );
  assert.deepEqual(decideIssue({ eventName: "pull_request", ref: "refs/pull/1/merge", openIssues: [] }), {
    action: "none",
  });
});

test("the issue names the run and a failure with no line break", () => {
  const { body } = issueFor({
    runUrl: "https://github.com/krizaka/yomizaka/actions/runs/1",
    sha: "abc",
    failure: "checkout FAILED: x\n- forged line",
  });
  assert.match(body, /actions\/runs\/1/);
  assert.doesNotMatch(body, /\n- forged line/);
});

test("the guard files the issue through the API on main, and says nothing elsewhere", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    return { ok: true, json: async () => (init.method === "POST" ? { number: 42 } : []) };
  };
  const env = {
    GITHUB_REPOSITORY: "krizaka/yomizaka",
    GH_RUN_AUTH: "x",
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: "abc",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "9",
    JOURNEY_FAILURE: "boom",
  };
  await guard({ env, fetchImpl, log: () => {} });
  assert.deepEqual(calls, ["GET /repos/krizaka/yomizaka/issues", "POST /repos/krizaka/yomizaka/issues"]);
  calls.length = 0;
  await guard({
    env: { ...env, GITHUB_REF: "refs/pull/3/merge", GITHUB_EVENT_NAME: "pull_request" },
    fetchImpl,
    log: () => {},
  });
  assert.deepEqual(calls, []);
});

test("the workflow runs on main and by schedule only, never on a pull request, and files the issue when red", () => {
  assert.doesNotMatch(workflow, /^\s*pull_request/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: dev/);
  assert.match(workflow, /issues: write/);
  assert.ok(
    workflow.indexOf("pnpm install --frozen-lockfile") < workflow.indexOf("run: node scripts/checkout-journey.mjs"),
    "install before the journey",
  );
  assert.ok(
    workflow.indexOf("run: node scripts/checkout-journey.mjs") <
      workflow.indexOf("node scripts/checkout-journey-guard.mjs"),
  );
  assert.match(workflow, /if: failure\(\)/);
});

test("paying returns to the product's public address, not to the dev host the API is driven on (krizaka-internal#2273)", () => {
  const hosted = "https://checkout.stripe.com/c/pay/cs_test_abc#frag";
  assert.equal(returnedFromCheckout("https://www.yomizaka.com/fr/app?paid=pro", hosted), true);
  assert.equal(returnedFromCheckout("https://dev.yomizaka.com/fr/app?paid=pro", hosted), true);
  assert.equal(returnedFromCheckout("https://checkout.stripe.com/c/pay/cs_test_abc", hosted), false);
  assert.equal(returnedFromCheckout("about:blank", hosted), false);
  assert.equal(returnedFromCheckout("http://www.yomizaka.com/fr/app", hosted), false);
});
