// The pure parts of the checkout journey (scripts/checkout-journey.mjs) and of its fail-on-main guard
// (scripts/checkout-journey-guard.mjs): what a Stripe TEST key is, what « bought » looks like, when a red run opens an issue.

/** The Stripe TEST card the hosted page accepts (Stripe's documented success card). Never a real card. */
export const TEST_CARD = {
  number: "4242424242424242",
  expiry: "12 / 34",
  cvc: "123",
  name: "Persona Yomizaka",
  postal: "H2X 1Y4",
};

/** The plan the persona buys: the cheapest subscription of the catalogue (apps/web/lib/pricing.ts, SOLD). */
export const PLAN = { kind: "agency", priceKey: "yomizaka.agency" };

/** A processor key is accepted only if it is a TEST key: the journey never touches live mode. Pure. */
export function assertTestKey(key) {
  if (typeof key !== "string" || !/^sk_test_[A-Za-z0-9]{10,}$/.test(key))
    throw new Error("the Stripe key must be a test key (sk_test_...): the checkout journey never runs in live mode");
  return key;
}

/** The hosted page must be Stripe's own (https, checkout.stripe.com): anything else is a failure, not a page to fill. Pure. */
export function isHostedCheckout(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

/**
 * Whether the browser is back on the product after paying: off the hosted checkout, on any address of the product. The
 * checkout returns to APP_PUBLIC_URL (www.yomizaka.com), which is not the dev host the journey drives the API on
 * (krizaka-internal#2273): the origin of `--base` is never the test. Pure.
 */
export function returnedFromCheckout(value, hostedUrl) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== new URL(hostedUrl).hostname;
  } catch {
    return false;
  }
}

/** Whether the account's entitlement (GET /api/billing) is the subscription the persona bought. Pure. */
export function isSubscribed(entitlement, plan = PLAN) {
  return (
    Boolean(entitlement?.pro) && entitlement.subscriptionStatus === "active" && entitlement.planKey === plan.priceKey
  );
}

/** The paid row of the account's payment history that carries a receipt (GET /api/billing/payments), or null. Pure. */
export function paidReceipt(payments) {
  return (
    (Array.isArray(payments) ? payments : []).find(
      (p) => p?.state === "paid" && typeof p.receiptUrl === "string" && p.receiptUrl.startsWith("https://"),
    ) ?? null
  );
}

/** A signed report answer is a PDF with its fingerprint. Pure. */
export function isSignedPdf({ contentType, bytes, sha256 }) {
  const magic = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  return /application\/pdf/.test(contentType ?? "") && magic === "%PDF-" && /^[a-f0-9]{64}$/.test(sha256 ?? "");
}

/** A line safe to print: printable characters only, no line break an input could use to forge a log line. Pure. */
export const plain = (text) =>
  String(text)
    .replace(/[^\x20-\x7EÀ-ſ]/g, " ")
    .slice(0, 300);

/** Where a red run is a finding: the default branch only (a dispatch or a schedule runs there), never a pull request. Pure. */
export function shouldOpenIssue({ eventName, ref }) {
  return ref === "refs/heads/main" && (eventName === "schedule" || eventName === "workflow_dispatch");
}

export const ISSUE_TITLE = "Checkout journey red on main: a persona cannot buy a plan on dev";

/** The issue a red run files (or, when one is open, the comment it adds). The failure text is the journey's own. Pure. */
export function issueFor({ runUrl, sha, failure }) {
  const body = [
    "The checkout journey (`.github/workflows/checkout-journey.yml`) failed on `main`: the dev persona, with Stripe's TEST card, did not end with an active subscription, a receipt and a signed report.",
    "",
    `- Run: ${runUrl}`,
    `- Commit: ${sha}`,
    `- Failure: ${plain(failure || "see the run log")}`,
    "",
    "A red here means a customer could not pay. Fix the cause, then re-dispatch the workflow on `main`; it closes nothing by itself.",
  ].join("\n");
  return { title: ISSUE_TITLE, body };
}

/** One decision: nothing, a new issue, or a comment on the open one. Pure. */
export function decideIssue({ eventName, ref, openIssues }) {
  if (!shouldOpenIssue({ eventName, ref })) return { action: "none" };
  const open = (openIssues ?? []).find((i) => i.title === ISSUE_TITLE && !i.pull_request);
  return open ? { action: "comment", number: open.number } : { action: "create" };
}
