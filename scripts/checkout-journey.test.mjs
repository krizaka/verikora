import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { reportFor, reportPath } from "./checkout-journey-report.mjs";
import {
  assertTestKey,
  isHostedCheckout,
  isSignedPdf,
  isSubscribed,
  describeStuckForm,
  describeStuckPage,
  ISSUE_TITLE,
  issueFor,
  paidReceipt,
  returnedFromCheckout,
  billingSteps,
  TEST_BILLING,
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

test("the issue names the run and a failure with no line break", () => {
  const { body } = issueFor({
    runUrl: "https://github.com/krizaka/yomizaka/actions/runs/1",
    sha: "abc",
    failure: "checkout FAILED: x\n- forged line",
  });
  assert.match(body, /actions\/runs\/1/);
  assert.doesNotMatch(body, /\n- forged line/);
});

test("the report is the issue of the standard title, written for the shared alert action", () => {
  assert.match(ISSUE_TITLE, /^yomizaka · fix\(checkout\): /);
  const { title, body } = reportFor({
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "krizaka/yomizaka",
    GITHUB_RUN_ID: "9",
    GITHUB_SHA: "abc",
    JOURNEY_FAILURE: "boom",
  });
  assert.equal(title, ISSUE_TITLE);
  assert.match(body, /actions\/runs\/9/);
  assert.match(body, /boom/);
});

test("the workflow runs on main and by schedule only, never on a pull request, and files the issue when red", () => {
  assert.doesNotMatch(workflow, /^\s*pull_request/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: dev/);
  // Our alerts live in the private krizaka-internal (krizaka-internal#2267): the app token through the shared action, never the job token.
  assert.doesNotMatch(workflow, /issues: write|github\.token/);
  assert.match(workflow, /uses: krizaka\/\.github\/actions\/alert-issue@[0-9a-f]{40}/);
  assert.ok(
    workflow.indexOf("pnpm install --frozen-lockfile") < workflow.indexOf("run: node scripts/checkout-journey.mjs"),
    "install before the journey",
  );
  assert.ok(
    workflow.indexOf("run: node scripts/checkout-journey.mjs") <
      workflow.indexOf("node scripts/checkout-journey-report.mjs"),
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

test("the report is written only inside the runner's temporary folder (no path traversal)", () => {
  assert.equal(reportPath("journey.md", "/runner/tmp"), "/runner/tmp/journey.md");
  assert.equal(reportPath("/runner/tmp/journey.md", "/runner/tmp"), "/runner/tmp/journey.md");
  assert.throws(() => reportPath("../etc/passwd", "/runner/tmp"), /outside/);
  assert.throws(() => reportPath("/etc/passwd", "/runner/tmp"), /outside/);
  assert.throws(() => reportPath("/runner/tmpx/journey.md", "/runner/tmp"), /outside/);
});

test("the stuck page is described by its address without secrets, its title and the card digits masked (krizaka-internal#2273)", () => {
  const d = describeStuckPage({
    url: "https://checkout.stripe.com/c/pay/cs_test_a1B2c3?token=abc123&x=1#fidkdWxOYHwnPyd1blpxYHZxWjA0",
    title: "Pay Yomizaka 4242 4242 4242 4242",
  });
  assert.equal(d.url, "https://checkout.stripe.com/c/pay/cs_test_[id]");
  assert.equal(d.title, "Pay Yomizaka [card]");
  assert.doesNotMatch(JSON.stringify(d), /abc123|fidkdWx|a1B2c3|4242/);
  assert.equal(describeStuckPage({ url: "not a url", title: undefined }).url, "[unreadable address]");
  assert.equal(
    describeStuckPage({ url: "https://www.yomizaka.com/fr/app?paid=pro", title: "" }).url,
    "https://www.yomizaka.com/fr/app",
  );
});

test("the workflow keeps the diagnosis of a red run as a short-lived artifact", () => {
  assert.match(workflow, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /path: journey-diagnosis/);
  assert.match(workflow, /retention-days: [1-7]\b/);
  assert.match(workflow, /if-no-files-found: ignore/);
});

test("the persona pays from Canada: a complete, fictitious Montreal address, in Canada's postal format (krizaka-internal#2316)", () => {
  assert.equal(TEST_BILLING.country, "CA");
  assert.equal(TEST_BILLING.region, "QC");
  assert.equal(TEST_BILLING.city, "Montréal");
  assert.match(TEST_BILLING.postal, /^[A-Z]\d[A-Z] \d[A-Z]\d$/);
  for (const field of ["line1", "city", "region", "postal"]) assert.ok(TEST_BILLING[field], `${field} is filled`);
});

test("the hosted page's billing country is chosen first, before the fields it reshapes", () => {
  const steps = billingSteps();
  assert.deepEqual(steps[0], { selector: "#billingCountry", action: "select", value: "CA" });
  assert.deepEqual(
    steps.map((s) => s.selector),
    [
      "#billingCountry",
      "#billingName",
      "#billingAddressLine1",
      "#billingLocality",
      "#billingAdministrativeArea",
      "#billingPostalCode",
    ],
  );
  assert.equal(steps.find((s) => s.selector === "#billingAdministrativeArea").action, "select");
  assert.equal(steps.find((s) => s.selector === "#billingPostalCode").value, TEST_BILLING.postal);
});

test("the address line closes Google's suggestion list before the next field, so nothing covers the city or the submit button", () => {
  const steps = billingSteps();
  const line = steps.find((s) => s.selector === "#billingAddressLine1");
  assert.equal(line.press, "Escape");
  for (const s of steps.filter((s) => s !== line)) assert.equal(s.press, undefined, s.selector);
});

test("the address line is followed by a click on the blank side of the page, the only way that closes the suggestions", () => {
  const line = billingSteps().find((s) => s.selector === "#billingAddressLine1");
  assert.equal(line.blur, true);
});

test("a stuck form is recorded with its billing values and its error texts, never a card (krizaka-internal#2316)", () => {
  const d = describeStuckForm({
    fields: [
      { id: "cardNumber", value: "4242 4242 4242 4242" },
      { id: "cardCvc", value: "123" },
      { id: "billingLocality", value: "Montréal" },
      { id: "billingPostalCode", value: "H2X 1Y4" },
      { id: "billingName", value: "Persona 4242 4242 4242 4242" },
      { id: "", value: "no id" },
    ],
    errors: ["Your card was declined.", "Your card was declined.", "  ", "Invalid\nZIP"],
  });
  assert.deepEqual(
    d.fields.map((f) => f.id),
    ["billingLocality", "billingPostalCode", "billingName"],
  );
  assert.equal(d.fields[1].value, "H2X 1Y4");
  assert.equal(d.fields[2].value, "Persona [card]");
  assert.deepEqual(d.errors, ["Your card was declined.", "Invalid ZIP"]);
  assert.doesNotMatch(JSON.stringify(d), /4242|123"/);
  assert.deepEqual(describeStuckForm({ fields: null, errors: undefined }), { fields: [], errors: [] });
});

test("the journey settles the hosted page and presses submit again when a click is swallowed (krizaka-internal#2316)", () => {
  const source = readFileSync(new URL("./checkout-journey.mjs", import.meta.url), "utf8");
  assert.match(source, /waitForLoadState\("networkidle"/);
  assert.match(source, /SUBMIT_ATTEMPTS = [2-9]/);
  assert.match(source, /payment-method-label-card/);
});
