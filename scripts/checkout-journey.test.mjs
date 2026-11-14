import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { reportFor, reportPath } from "./checkout-journey-report.mjs";
import {
  assertTestKey,
  isHostedCheckout,
  isSignedPdf,
  boughtOneFile,
  chargedForSale,
  forSale,
  ON_SALE,
  PLAN,
  describeStuckForm,
  describeStuckPage,
  ISSUE_TITLE,
  issueFor,
  paidReceipt,
  returnedFromCheckout,
  CARD_METHOD,
  PAY_BUTTON,
  PAYMENT_FRAME_FIELDS,
  describeFrames,
  formSteps,
  isCadOption,
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
    "https://dev.verikora.com/pay",
    "not a url",
    undefined,
  ])
    assert.equal(isHostedCheckout(bad), false);
});

test("bought means one credit more and no subscription", () => {
  assert.equal(boughtOneFile({ credits: 0, pro: false }, { credits: 1, pro: false }), true);
  assert.equal(boughtOneFile({ credits: 2, pro: false }, { credits: 2, pro: false }), false);
  assert.equal(boughtOneFile({ credits: 0, pro: false }, { credits: 1, pro: true }), false);
  assert.equal(boughtOneFile(undefined, { credits: 1 }), false);
});

test("the receipt is the catalogue's price plus taxes, in its currency", () => {
  const entry = { amountCents: 999, currency: "CAD" };
  assert.equal(chargedForSale({ amountCents: 1148, currency: "cad" }, entry), true);
  assert.equal(chargedForSale({ amountCents: 999, currency: "cad" }, entry), true);
  assert.equal(chargedForSale({ amountCents: 500, currency: "cad" }, entry), false);
  assert.equal(chargedForSale({ amountCents: 1148, currency: "usd" }, entry), false);
  assert.equal(chargedForSale(null, entry), false);
});

test("the journey asks only for what is on sale: a « soon » entry is listed but not buyable", () => {
  const listed = [
    { key: "verikora.agency", amountCents: 4900, availability: "preparing" },
    { key: "verikora.document", amountCents: 999, availability: "public" },
  ];
  assert.equal(forSale(listed, PLAN).amountCents, 999);
  assert.equal(forSale(listed, { kind: "agency", priceKey: "verikora.agency" }), null);
  assert.equal(forSale([{ key: "verikora.document", amountCents: null, availability: "public" }], PLAN), null);
  assert.equal(forSale(undefined, PLAN), null);
});

test("the plan the journey buys is on sale in the shipped catalogue, and its words are the code's", async () => {
  const { PRICES, SOLD } = await import("../apps/web/lib/pricing");
  const { onSale } = await import("../apps/web/lib/prices/plan");
  assert.equal(SOLD[PLAN.kind].key, PLAN.priceKey, "the kind is the one that sells this entry");
  const entry = PRICES.defaultOf(PLAN.priceKey);
  assert.ok(entry, "the entry exists");
  assert.ok(entry.amountCents !== null, "it has a figure");
  assert.ok(
    ON_SALE.includes(entry.availability),
    `${PLAN.priceKey} is ${entry.availability}: the checkout would answer 409 NOT_ON_SALE`,
  );
  // The checkout's own gate accepts it (it throws 409 NOT_ON_SALE for a « soon » entry), and the journey's words agree with it.
  const processor = { amount: entry.amountCents, currency: entry.currency ?? "cad" };
  assert.equal(onSale({ ...entry, currency: processor.currency }, processor).amountCents, entry.amountCents);
  assert.throws(() => onSale({ ...entry, availability: "preparing", currency: "cad" }, processor), /not on sale/);
  assert.ok(!ON_SALE.includes("preparing"));
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
    runUrl: "https://github.com/krizaka/verikora/actions/runs/1",
    sha: "abc",
    failure: "checkout FAILED: x\n- forged line",
  });
  assert.match(body, /actions\/runs\/1/);
  assert.doesNotMatch(body, /\n- forged line/);
});

test("the report is the issue of the standard title, written for the shared alert action", () => {
  assert.match(ISSUE_TITLE, /^verikora · fix\(checkout\): /);
  const { title, body } = reportFor({
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "krizaka/verikora",
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
  assert.equal(returnedFromCheckout("https://www.verikora.com/fr/app?paid=pro", hosted), true);
  assert.equal(returnedFromCheckout("https://dev.verikora.com/fr/app?paid=pro", hosted), true);
  assert.equal(returnedFromCheckout("https://checkout.stripe.com/c/pay/cs_test_abc", hosted), false);
  assert.equal(returnedFromCheckout("about:blank", hosted), false);
  assert.equal(returnedFromCheckout("http://www.verikora.com/fr/app", hosted), false);
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
    title: "Pay Verikora 4242 4242 4242 4242",
  });
  assert.equal(d.url, "https://checkout.stripe.com/c/pay/cs_test_[id]");
  assert.equal(d.title, "Pay Verikora [card]");
  assert.doesNotMatch(JSON.stringify(d), /abc123|fidkdWx|a1B2c3|4242/);
  assert.equal(describeStuckPage({ url: "not a url", title: undefined }).url, "[unreadable address]");
  assert.equal(
    describeStuckPage({ url: "https://www.verikora.com/fr/app?paid=pro", title: "" }).url,
    "https://www.verikora.com/fr/app",
  );
});

test("the workflow keeps the diagnosis of a red run as a short-lived artifact", () => {
  assert.match(workflow, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /path: journey-diagnosis/);
  assert.match(workflow, /retention-days: [1-7]\b/);
  assert.match(workflow, /if-no-files-found: ignore/);
});

test("the persona pays from Canada: its country and a postal code in Canada's format (krizaka-internal#2316)", () => {
  assert.equal(TEST_BILLING.country, "CA");
  assert.match(TEST_BILLING.postal, /^[A-Z]\d[A-Z] \d[A-Z]\d$/);
});

test("the form's fields are the payment frame's `name`s, which do not change with the page's language (run 43470813543)", () => {
  const steps = formSteps("persona@example.test");
  assert.deepEqual(
    steps.map((s) => s.selector),
    [
      "input[name=email]",
      "input[name=number]",
      "input[name=expiry]",
      "input[name=cvc]",
      "input[name=name]",
      "select[name=country]",
      "input[name=postalCode]",
      "input[name=linkOptIn]",
    ],
  );
  for (const s of steps)
    assert.doesNotMatch(s.selector, /#(cardNumber|billing|payment-method)/, "no id of the old page");
  assert.equal(steps[0].value, "persona@example.test");
  assert.equal(steps[0].action, "fill-if-empty");
  assert.equal(steps.find((s) => s.selector === "select[name=country]").value, "CA");
  assert.equal(steps.find((s) => s.selector === "input[name=postalCode]").value, TEST_BILLING.postal);
});

test("the country is chosen before the fields it reshapes, and the persona pays without Link", () => {
  const selectors = formSteps("a@b.test").map((s) => s.selector);
  assert.ok(selectors.indexOf("select[name=country]") < selectors.indexOf("input[name=postalCode]"));
  assert.deepEqual(formSteps("a@b.test").at(-1), { selector: "input[name=linkOptIn]", action: "uncheck" });
});

test("the card method and the pay button are found by their name, in English and in French", () => {
  for (const word of ["Card", "Carte", "card"]) assert.match(word, CARD_METHOD);
  for (const word of ["Klarna", "Pay with Card", "Carte bancaire"]) assert.doesNotMatch(word, CARD_METHOD);
  for (const word of ["Pay", "Payer"]) assert.match(word, PAY_BUTTON);
  for (const word of ["Pay securely with Link", "Payez en toute sécurité avec Link", "Payer avec"])
    assert.doesNotMatch(word, PAY_BUTTON);
  assert.equal(PAYMENT_FRAME_FIELDS, "input[name=email], input[name=number]");
});

test("the currency choice of Adaptive Pricing takes the catalogue's own currency, in both languages", () => {
  for (const name of ["CA$9.99", "9,99 $CA", "CAD", "Dollar canadien", "Canadian dollar"])
    assert.ok(isCadOption(name), name);
  for (const name of ["US$7.29", "7,29 $US", "USD", "Card", "", null, undefined])
    assert.ok(!isCadOption(name), String(name));
});

test("the frames of a stuck page are described without a card number, without a session id and cut", () => {
  const out = describeFrames([
    {
      url: "https://checkout.stripe.com/g/pay/cs_test_abc123?x=1",
      tree: `- textbox: 4242 4242 4242 4242\n${"x".repeat(5000)}`,
    },
  ]);
  assert.equal(out[0].url, "https://checkout.stripe.com/g/pay/cs_test_[id]");
  assert.doesNotMatch(out[0].tree, /4242/);
  assert.ok(out[0].tree.length <= 3000);
  assert.deepEqual(describeFrames(null), []);
});

test("a field the page marks invalid is recorded as such, even when no error text shows", () => {
  const d = describeStuckForm({
    fields: [
      { id: "phoneNumber", value: "", invalid: true },
      { id: "billingLocality", value: "Montréal", invalid: false },
    ],
    errors: [],
  });
  assert.deepEqual(d.fields, [
    { id: "phoneNumber", value: "", invalid: true },
    { id: "billingLocality", value: "Montréal" },
  ]);
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
  assert.match(source, /getByRole\("button", \{ name: CARD_METHOD \}\)/);
  assert.doesNotMatch(source, /#cardNumber|#payment-method-label-card/);
});

test("the browser install survives an apt mirror outage: retried with a reason, never silently skipped (run 43040951866)", () => {
  assert.match(workflow, /Acquire::Retries/);
  assert.match(workflow, /for attempt in 1 2 3; do\s+pnpm exec playwright-core install --with-deps chromium && exit 0/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});
