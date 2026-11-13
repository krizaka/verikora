// The pure parts of the checkout journey (scripts/checkout-journey.mjs) and of its fail-on-main guard
// (scripts/checkout-journey-report.mjs): what a Stripe TEST key is, what « bought » looks like, when a red run opens an issue.

/** The Stripe TEST card the hosted page accepts (Stripe's documented success card). Never a real card. */
export const TEST_CARD = {
  number: "4242424242424242",
  expiry: "12 / 34",
  cvc: "123",
  name: "Persona Verikora",
};

/**
 * The persona's billing address (Eric, Montréal; fictitious, docs/demo-data.md). The hosted page defaults the country to where the
 * runner geolocates (the United States on GitHub), and then asks a full address and a ZIP that turns "H2X 1Y4" into "214"
 * (krizaka-internal#2316): the journey says it is in Canada, as the persona is.
 */
export const TEST_BILLING = {
  country: "CA",
  line1: "123 rue Exemple",
  city: "Montréal",
  region: "QC",
  postal: "H2X 1Y4",
};

/** The hosted page's billing fields in the order they are filled: the country first (it reshapes the others). Pure. */
export function billingSteps(billing = TEST_BILLING, name = TEST_CARD.name) {
  return [
    { selector: "#billingCountry", action: "select", value: billing.country },
    { selector: "#billingName", action: "fill", value: name },
    // Typing the line opens a Google suggestion list over the next fields and the submit button: Escape closes it.
    { selector: "#billingAddressLine1", action: "fill", value: billing.line1, press: "Escape", blur: true },
    { selector: "#billingLocality", action: "fill", value: billing.city },
    { selector: "#billingAdministrativeArea", action: "select", value: billing.region },
    { selector: "#billingPostalCode", action: "fill", value: billing.postal },
    // From Canada, Stripe ticks « save my information with Link » by itself, which makes a phone number required: the submit then
    // does nothing (only an icon on the empty field, krizaka-internal#2316). The persona pays without Link.
    { selector: "#enableStripePass", action: "uncheck" },
  ];
}

/**
 * What the persona buys: one file at the catalogue price (apps/web/lib/pricing.ts, SOLD). The subscriptions are « soon » since
 * 2026-11-12: the checkout answers 409 NOT_ON_SALE for them (apps/web/lib/prices/plan.ts, onSale), so the journey never asks for one.
 */
export const PLAN = { kind: "document", priceKey: "verikora.document" };

/** The availabilities `onSale` (apps/web/lib/prices/plan.ts) sells: the same two words, kept equal by checkout-journey.test.mjs. */
export const ON_SALE = ["public", "founderLimited"];

/**
 * The entry of GET /api/billing `prices` the journey may buy: the plan's, with a figure and on sale. `prices` also lists the entries
 * « soon », so being listed is not being for sale. Null when the plan cannot be bought. Pure.
 */
export function forSale(prices, plan = PLAN) {
  const entry = (Array.isArray(prices) ? prices : []).find((p) => p?.key === plan.priceKey);
  return entry && Number.isInteger(entry.amountCents) && ON_SALE.includes(entry.availability) ? entry : null;
}

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
 * checkout returns to APP_PUBLIC_URL (www.verikora.com), which is not the dev host the journey drives the API on
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

/**
 * What the journey records when the page does not go where it should: the address without its query, its fragment (Stripe keeps
 * the session there) or the session id in the path, and the title without anything that looks like a card number. Pure.
 */
export function describeStuckPage({ url, title }) {
  let address = "[unreadable address]";
  try {
    const u = new URL(url);
    address = `${u.origin}${u.pathname.replace(/\/cs_(test|live)_[A-Za-z0-9]+/g, "/cs_$1_[id]")}`;
  } catch {
    // keep the placeholder: a broken address is itself the finding
  }
  return { url: address, title: plain(String(title ?? "").replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")) };
}

/**
 * What the journey records about the hosted form when the submit led nowhere (krizaka-internal#2316): each visible field's id and its
 * value (the card fields are never read; anything that looks like a card number is masked) and every visible error text, deduplicated.
 * A field the page marks invalid (aria-invalid) says so even when no error text shows (Link's phone only drew an icon).
 * `fields` is [{ id, value, invalid }] and `errors` is [text], as the page gives them. Pure.
 */
export function describeStuckForm({ fields, errors }) {
  const card = /(?:^(?:card|cvc|expiry))|(?:cardnumber)/i;
  const mask = (text) => plain(String(text ?? "").replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")).slice(0, 80);
  return {
    fields: (Array.isArray(fields) ? fields : [])
      .filter((f) => f && typeof f.id === "string" && f.id !== "" && !card.test(f.id))
      .slice(0, 30)
      .map((f) => ({
        id: plain(f.id).slice(0, 60),
        value: mask(f.value),
        ...(f.invalid === true ? { invalid: true } : {}),
      })),
    errors: [...new Set((Array.isArray(errors) ? errors : []).map((e) => mask(e).trim()).filter(Boolean))].slice(0, 10),
  };
}

/**
 * Whether the account bought one file: one credit more than before, and no subscription (what is sold is a file, not a plan). Pure.
 */
export function boughtOneFile(before, after) {
  return (
    Number.isInteger(before?.credits) &&
    Number.isInteger(after?.credits) &&
    after.credits === before.credits + 1 &&
    !after.pro
  );
}

/** Whether a receipt row is for the price on sale: the catalogue's figure plus the taxes the processor adds, in the catalogue's currency. Pure. */
export function chargedForSale(receipt, entry) {
  return (
    Number.isInteger(receipt?.amountCents) &&
    receipt.amountCents >= entry.amountCents &&
    String(receipt.currency).toLowerCase() === String(entry.currency).toLowerCase()
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

export const ISSUE_TITLE =
  "verikora · fix(checkout): a persona cannot buy a plan on dev (the checkout journey is red on main)";

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
