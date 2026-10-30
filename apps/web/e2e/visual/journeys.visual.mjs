// The main journeys of Yomizaka, compared to their baselines (krizaka/.github#375), as the seeded persona Éric (the cast,
// krizaka/.github#356: scripts/demo-seed, CI-only credentials, never a real account).
import { readFileSync } from "node:fs";

import { defineJourneyTests } from "@krizaka/page-audit/visual";
import { expect, test } from "@playwright/test";

const BASE = process.env.VISUAL_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "eric@demo.yomizaka.test";
const SECRET = process.env.E2E_PASSWORD ?? "ci-only-demo-password-0123";
// Rows are stamped with the day of the run: dates are masked, and the browser clock is the moment the seed finished.
const NOW = (() => {
  try {
    return readFileSync(new URL("../../../../.visual-now", import.meta.url), "utf8").trim();
  } catch {
    return undefined;
  }
})();
const LIVE = ["time", "[data-live]"];

/** Signs in through the form, as a person would; the session cookie is kept for the signed-in captures. */
async function signIn(page) {
  await page.goto(new URL("/fr/sign-in", BASE).toString());
  await page.locator("input[type=email]").first().fill(EMAIL);
  await page.locator("input[type=password]").first().fill(SECRET);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/app(\/|\?|$)/, { timeout: 60_000 });
}

/** The report of the first seeded document (its id is random). */
async function firstReport(page, { origin }) {
  await page.goto(new URL("/fr/app/documents", origin).toString());
  const href = await page.locator('a[href*="/app/documents/"]').first().getAttribute("href");
  const id = href?.match(/\/app\/documents\/([^/?#]+)/)?.[1];
  if (!id) throw new Error("no seeded document on the library: is the cast seeded?");
  return `/fr/app/documents/${id}/rapport`;
}

/** The report of the seeded lease whose title holds `words` (Section G on the lease without notice, art. 1904 on the one with illegal clauses; yomizaka#104). */
const reportTitled = (words) => async (page, { origin }) => {
  await page.goto(new URL("/fr/app/documents", origin).toString());
  const href = await page.locator('a[href*="/app/documents/"]', { hasText: words }).first().getAttribute("href");
  const id = href?.match(/\/app\/documents\/([^/?#]+)/)?.[1];
  if (!id) throw new Error(`no seeded document titled « ${words} »: is the cast seeded?`);
  return `/fr/app/documents/${id}/rapport`;
};

/** The seeded applicant file, with two figures typed in the rent-share section (information only, in memory). */
async function firstFile(page, { origin }) {
  await page.goto(new URL("/fr/app/dossiers", origin).toString());
  const href = await page.locator('a[href*="/app/dossiers/"]').first().getAttribute("href");
  const id = href?.match(/\/app\/dossiers\/([^/?#]+)/)?.[1];
  if (!id) throw new Error("no seeded applicant file: is the cast seeded?");
  return `/fr/app/dossiers/${id}`;
}
/** The hydrated first paint, settled: the account picture decoded (the initial gives way to it). The date in words is the server's, frozen by APP_VISUAL_NOW (scripts/ci-visual-start.sh). */
async function settleHeaderLive(page) {
  await page.locator('time[data-testid="today"]').first().waitFor();
  await page.waitForFunction(() =>
    [...document.images].some((img) => img.getBoundingClientRect().top < 120 && img.complete && img.naturalWidth > 0),
  );
}
/** The dates of a list are stamped by the database at seed time (real, not frozen): the masked box still takes the width of its text, and a table sizes its columns from it, so a day with other digits moved the columns by a pixel. They get one width, by style: a text swap raced the page's own rendering after hydration (98 px one run, 81 px the next, yomizaka#641). */
async function fixListDates(page) {
  await page.locator('time:not([data-testid="today"])').first().waitFor({ state: "attached" });
  await page.addStyleTag({ content: 'time:not([data-testid="today"]) { display: inline-block; width: 7rem; white-space: nowrap; overflow: hidden; text-align: right; }' });
}
/** A finding stays inside its card: no long address pushes the page wider than the screen (the TAL address on a phone). */
const staysInside = (ruleId) => async (page) => {
  const wide = await page.evaluate((id) => {
    const card = document.getElementById(`finding-${id}`);
    return card ? card.scrollWidth > card.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth : true;
  }, ruleId);
  expect(wide, `finding ${ruleId} overflows its card`).toBe(false);
};
/** Brings a finding of the report to the top of the screen, so the capture shows it and not the header. */
const showFinding = (ruleId) => async (page) => {
  await page.locator(`#finding-${ruleId}`).scrollIntoViewIfNeeded();
  await page.evaluate((id) => document.getElementById(`finding-${id}`)?.scrollIntoView({ block: "start" }), ruleId);
};
async function typeRentShare(page) {
  await page.locator("#rent-share-rent").fill("1450");
  await page.locator("#rent-share-income").fill("4200");
  await page.locator('[data-testid="rent-share-result"] p').first().waitFor();
  // The page's own lists (the active links) load after the first paint and change its height, hence where the scroll stops: settle first.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.getElementById("rent-share-title")?.scrollIntoView({ block: "start" }));
}

/** Streaming settled: React sends a late part of the page in a hidden `S:` container and moves it into place in a script it may delay by up to 2.3 s; until then the same ids are in the page twice (the report journeys saw `#finding-TS-P-001`, `#rent-share-rent` twice, #635). */
async function settleStream(page) {
  await page.waitForFunction(() => !document.querySelector('[hidden][id^="S:"]'));
}
/** An id is in a page once (invalid HTML and broken labels otherwise): the duplicates are named with the chain of their parents. */
async function expectUniqueIds(page) {
  const duplicates = await page.evaluate(() => {
    const where = (el) => {
      const chain = [];
      for (let n = el; n && n !== document.body && chain.length < 5; n = n.parentElement) chain.push(`${n.localName}${n.id ? `#${n.id}` : ""}${n.hidden ? "[hidden]" : ""}`);
      return chain.join(" < ");
    };
    const seen = new Map();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, [...(seen.get(el.id) ?? []), where(el)]);
    return [...seen].filter(([, places]) => places.length > 1).map(([id, places]) => `${id}: ${places.join(" | ")}`);
  });
  expect(duplicates, "ids that appear twice in the page").toEqual([]);
}
/** Every journey with JavaScript starts from a settled page whose ids are unique, then runs its own `ready`. */
const withSettledDom = (journey) =>
  journey.firstPaint === true
    ? journey
    : {
        ...journey,
        ready: async (page) => {
          await settleStream(page);
          await expectUniqueIds(page);
          if (typeof journey.ready === "string") await page.locator(journey.ready).first().waitFor();
          else if (journey.ready) await journey.ready(page);
        },
      };

defineJourneyTests({
  test,
  expect,
  base: BASE,
  signIn,
  ...(NOW ? { now: NOW } : {}),
  journeys: [
    { name: "landing", path: "/fr", mask: LIVE },
    { name: "pricing", path: "/fr/pricing", mask: LIVE },
    { name: "sign-in", path: "/fr/sign-in" },
    { name: "app-home", path: "/fr/app", session: true, mask: LIVE },
    // The library, where the bookmarks live (#339): the guard they lacked.
    { name: "documents", path: "/fr/app/documents", session: true, ready: fixListDates, mask: LIVE },
    { name: "document-report", path: firstReport, session: true, mask: LIVE },
    // The tenant-shield findings in the report (yomizaka#104): Section G with the deadline and the facts for the TAL; the payment clauses (art. 1904).
    { name: "report-section-g", path: reportTitled("avis du TAL absent"), session: true, ready: async (page) => { await staysInside("TS-G-001")(page); await showFinding("TS-G-001")(page); }, mask: LIVE },
    { name: "report-payment-clauses", path: reportTitled("clause illégale"), session: true, ready: showFinding("TS-P-001"), mask: LIVE },
    { name: "file-rent-share", path: firstFile, session: true, ready: typeRentShare, mask: LIVE },
    // The first paint of a signed-in page: the HTML the server sent, and the hydrated page while the account query is pending (krizaka-ui#827).
    { name: "app-home", path: "/fr/app", session: true, firstPaint: true, viewports: ["phone"], mask: LIVE },
    { name: "app-home-pending", path: "/fr/app", session: true, firstPaint: { hold: ["**/api/me"] }, ready: settleHeaderLive, viewports: ["phone"], mask: LIVE },
  ].map(withSettledDom),
});
