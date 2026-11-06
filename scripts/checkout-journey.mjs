#!/usr/bin/env node
// The checkout journey (verikora P0, 2026-10-30): a persona BUYS a plan on the deployed dev with Stripe's TEST card, as a customer would.
//   sign in (bearer) -> the plan is for sale (paymentsOn) -> start the checkout -> pay on Stripe's hosted page with the 4242 card ->
//   the subscription turns active (the webhook) -> the payment history carries a receipt that opens -> one lease check ends in the signed PDF.
// It runs on main and by hand against the dev environment (never on a pull request: the persona and the TEST key are that environment's), and
// it ends by cancelling what it bought, so the next run starts clean. A red run on main files an issue in krizaka-internal (checkout-journey-report.mjs).
//
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... PAYMENTS_STRIPE_TEST_SECRET_KEY=sk_test_... node scripts/checkout-journey.mjs --base https://dev.verikora.com
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { auditContext, loadSettled } from "@krizaka/page-audit";

import {
  assertTestKey,
  billingSteps,
  describeStuckForm,
  describeStuckPage,
  isHostedCheckout,
  isSignedPdf,
  isSubscribed,
  paidReceipt,
  PLAN,
  returnedFromCheckout,
  plain,
  TEST_CARD,
} from "./checkout-journey-lib.mjs";
import { smokeLeaseCheck } from "./smoke-lease-check.mjs";

const SUBMIT_ATTEMPTS = 3;
const SUBMIT_WAIT_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `read` until `done(value)`, or fails with the sentence given. */
async function until(read, done, { what, timeoutMs, everyMs = 3000 }) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`${what} (not within ${Math.round(timeoutMs / 1000)} s)`);
    await sleep(everyMs);
  }
}

/** The processor's REST API with a TEST key: only to give back what the journey bought (cancel the subscriptions of the persona's customers). */
function processor(key) {
  assertTestKey(key);
  const call = async (path, init = {}) => {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`payment processor ${init.method ?? "GET"} ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };
  return {
    async cancelSubscriptionsOf(email) {
      const customers = await call(`/customers?limit=10&email=${encodeURIComponent(email)}`);
      let cancelled = 0;
      for (const customer of customers.data) {
        const subs = await call(`/subscriptions?limit=20&status=active&customer=${customer.id}`);
        for (const sub of subs.data) {
          await call(`/subscriptions/${sub.id}`, { method: "DELETE" });
          cancelled += 1;
        }
      }
      return cancelled;
    },
  };
}

/** One billing step on the hosted page, when its field is there. */
async function fillStep(page, step) {
  const field = page.locator(step.selector);
  // Stripe draws its own box over the checkbox: the input itself is hidden, so it is unticked when it exists at all.
  if (step.action === "uncheck") {
    if ((await field.count()) > 0) await field.setChecked(false, { force: true });
    return;
  }
  if (!(await field.isVisible().catch(() => false))) return;
  if (step.action === "select") await field.selectOption(step.value);
  else await field.fill(step.value);
  if (step.press) await field.press(step.press);
  // Google's address suggestions stay open over the next fields (Escape does not close them): a click on the blank side of the page does.
  if (step.blur) await page.mouse.click(20, 700);
}

/** As the persona does, from Canada: the country first (it reshapes the address fields), then each field that is there. */
async function fillBilling(page) {
  for (const step of billingSteps()) await fillStep(page, step);
}

/** Fills the hosted page with the TEST card and pays. The page's fields change now and then: each is filled when it is there. */
async function pay(page, hostedUrl, log = () => {}) {
  await loadSettled(page, hostedUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#cardNumber, #payment-method-label-card").first().waitFor({ state: "attached", timeout: 60_000 });
  // Card is the default method on the hosted page (from the US); from elsewhere it is a list with no method open: pick the card. The
  // label sits under a cover button that takes the pointer, so the click is forced onto the label's place.
  if (
    !(await page
      .locator("#cardNumber")
      .isVisible()
      .catch(() => false))
  )
    await page.locator("#payment-method-label-card").click({ force: true });
  await page.locator("#cardNumber").waitFor({ timeout: 60_000 });
  await page.locator("#cardNumber").fill(TEST_CARD.number);
  await page.locator("#cardExpiry").fill(TEST_CARD.expiry);
  await page.locator("#cardCvc").fill(TEST_CARD.cvc);
  await fillBilling(page);
  // The address recomputes the tax; a click while the page is still updating is swallowed (no error, no processing: the button just
  // stays, krizaka-internal#2316). Wait for the page to settle, then press until it leaves, a few times at most.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const submit = page.locator("[data-testid=hosted-payment-submit-button], button.SubmitButton").first();
  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS; attempt += 1) {
    await submit.click();
    const left = await page
      .waitForURL((url) => returnedFromCheckout(url.href, hostedUrl), { timeout: SUBMIT_WAIT_MS })
      .then(
        () => true,
        () => false,
      );
    if (left) return;
    log(`submit pressed ${attempt} time(s), the page did not leave the hosted checkout`);
  }
}

/** Where the page is stuck: its address (no secret), title and a full-page screenshot, kept as a workflow artifact. Never throws. */
async function recordStuckPage(page, dir, log) {
  try {
    mkdirSync(dir, { recursive: true });
    const seen = describeStuckPage({ url: page.url(), title: await page.title().catch(() => "") });
    writeFileSync(`${dir}/stuck-page.json`, `${JSON.stringify(seen, null, 2)}\n`);
    await page.screenshot({ path: `${dir}/stuck-page.png`, fullPage: true });
    const form = await page
      .evaluate(() => ({
        fields: [...document.querySelectorAll("input, select")]
          .filter((e) => e.offsetParent !== null)
          .map((e) => ({
            id: e.id || e.name,
            value: e.type === "checkbox" ? String(e.checked) : e.value,
            invalid: e.getAttribute("aria-invalid") === "true",
          })),
        errors: [...document.querySelectorAll("[role=alert], [class*=Error], [id*=rror]")].map((e) => e.innerText),
      }))
      .catch(() => ({ fields: [], errors: [] }));
    writeFileSync(`${dir}/stuck-form.json`, `${JSON.stringify(describeStuckForm(form), null, 2)}\n`);
    log(`stuck on ${seen.url} (${seen.title})`);
  } catch (error) {
    log(`could not record the stuck page: ${error.message}`);
  }
}

export async function checkoutJourney({
  base,
  email,
  password,
  stripeKey,
  log = () => {},
  openBrowser,
  diagnosisDir = "journey-diagnosis",
}) {
  if (!email || !password) throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required (the persona)");
  const stripe = processor(stripeKey);
  const call = async (path, init = {}, token) => {
    const res = await fetch(`${base}${path}`, {
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
  if (!signIn.res.ok || typeof signIn.body?.token !== "string") throw new Error(`sign-in: HTTP ${signIn.res.status}`);
  const token = signIn.body.token;
  const billing = () => call("/api/billing", {}, token).then((r) => r.body);

  const cancelled = await stripe.cancelSubscriptionsOf(email);
  log(`clean start (${cancelled} old subscription(s) cancelled)`);
  await until(billing, (b) => b && !b.entitlement?.pro, {
    what: "the persona still has a subscription after the clean start",
    timeoutMs: 60_000,
  }).catch(() => {});

  const before = await billing();
  if (!before?.paymentsOn)
    throw new Error("payments are off on this environment (paymentsOn is false): nothing to buy");
  if (!before.prices?.some((p) => p.key === PLAN.priceKey))
    throw new Error(`the plan ${PLAN.priceKey} is not for sale`);

  try {
    const started = await call(
      "/api/billing/checkout",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: PLAN.kind }) },
      token,
    );
    if (!started.res.ok || !isHostedCheckout(started.body?.url))
      throw new Error(
        `start the checkout: HTTP ${started.res.status}, ${isHostedCheckout(started.body?.url) ? "ok" : "no hosted page"}`,
      );
    log("checkout started");

    const { browser, close } = await openBrowser();
    try {
      const context = await auditContext(browser);
      const page = await context.newPage();
      try {
        await pay(page, started.body.url, log);
        await page.waitForURL((url) => returnedFromCheckout(url.href, started.body.url), { timeout: 90_000 });
      } catch (error) {
        await recordStuckPage(page, diagnosisDir, log);
        throw error;
      }
      log("paid, back on the site");
    } finally {
      await close();
    }

    const after = await until(billing, (b) => isSubscribed(b?.entitlement), {
      what: "the subscription did not turn active",
      timeoutMs: 120_000,
    });
    log(`subscription ${after.entitlement.subscriptionStatus}, plan ${after.entitlement.planKey}`);

    const history = await until(
      () => call("/api/billing/payments", {}, token).then((r) => r.body),
      (b) => paidReceipt(b?.payments) !== null,
      { what: "no paid receipt in the payment history", timeoutMs: 60_000 },
    );
    const receipt = paidReceipt(history.payments);
    const receiptPage = await fetch(receipt.receiptUrl, { redirect: "follow" });
    if (!receiptPage.ok) throw new Error(`the receipt did not open: HTTP ${receiptPage.status}`);
    log("receipt opens");

    const lease = await smokeLeaseCheck({
      base,
      email,
      password,
      log,
      onReport: async ({ token: bearer, documentId, analysisId }) => {
        const res = await fetch(
          `${base}/api/documents/${documentId}/analyses/${analysisId}/report?format=pdf&lang=en`,
          { headers: { authorization: `Bearer ${bearer}` } },
        );
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (
          !res.ok ||
          !isSignedPdf({
            contentType: res.headers.get("content-type"),
            bytes,
            sha256: res.headers.get("x-report-sha256"),
          })
        )
          throw new Error(`the signed report is not reachable: HTTP ${res.status}`);
        log("signed PDF reachable");
      },
    });
    return { plan: after.entitlement.planKey, findings: lease.findings };
  } finally {
    const gone = await stripe.cancelSubscriptionsOf(email).catch(() => -1);
    log(`gave back: ${gone} subscription(s) cancelled`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--base");
  const base = (i >= 0 ? process.argv[i + 1] : "https://dev.verikora.com").replace(/\/$/, "");
  try {
    const { chromium } = createRequire(import.meta.url)("playwright-core");
    const openBrowser = async () => {
      const browser = await chromium.launch();
      return { browser, close: () => browser.close() };
    };
    const result = await checkoutJourney({
      base,
      email: process.env.SMOKE_EMAIL,
      password: process.env.SMOKE_PASSWORD,
      stripeKey: process.env.PAYMENTS_STRIPE_TEST_SECRET_KEY,
      log: (m) => console.log(plain(m)),
      openBrowser,
    });
    console.log(`checkout on ${plain(base)}: succeeded, plan ${result.plan}, lease check ${result.findings} findings`);
  } catch (error) {
    console.error(`checkout on ${plain(base)} FAILED: ${plain(error.message)}`);
    process.exitCode = 1;
  }
}
