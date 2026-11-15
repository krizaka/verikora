#!/usr/bin/env node
// A signed-in person never sees the public side first (krizaka-ui#827), proven in a real browser as the seeded persona:
//   1. `/` and `/<locale>` land on the home (`/<locale>/app`), server-side, with no page of the landing in between;
//   2. a public page that stays reachable signed in (terms) never draws « Sign in » in the bar — not at the first paint,
//      not for an instant while `/api/me` answers (a MutationObserver from document start records any sign-in link of the header);
//   3. the same public page signed out still offers « Sign in » (the guard is not vacuous).
//
//   E2E_EMAIL=… E2E_PASSWORD=… node scripts/check-signed-in-landing.mjs --base http://localhost:3000 [--locale fr]
import { chromium } from "playwright-core";

import { auditContext, loadSettled } from "@krizaka/page-audit";

import { signIn } from "./check-app-pages.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** Records, from the first moment of the document, whether the header ever held a link to the sign-in page. */
export const watchSignInLink = () => {
  globalThis.__sawSignIn = false;
  const look = () => {
    if (document.querySelector('header a[href$="/sign-in"], nav a[href$="/sign-in"]')) globalThis.__sawSignIn = true;
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", look);
};

/** The path of a URL, for a message. Pure, tested. */
export const pathOf = (url) => new URL(url).pathname;

export async function check({ base, locale = "fr", email, password }) {
  if (!email || !password) throw new Error("E2E_EMAIL and E2E_PASSWORD are required (the seeded persona)");
  const browser = await chromium.launch();
  const problems = [];
  try {
    const context = await auditContext(browser, { viewport: { width: 1280, height: 800 } });
    await context.addInitScript(watchSignInLink);
    const page = await context.newPage();
    // Signed out first: the public page does offer « Sign in » (so the next checks mean something).
    await loadSettled(page, `${base}/${locale}/terms`);
    await page
      .waitForFunction(
        () => document.querySelector('header a[href$="/sign-in"], nav a[href$="/sign-in"]') !== null,
        null,
        { timeout: 15_000 },
      )
      .catch(() => {
        problems.push(`/${locale}/terms signed out: no « Sign in » link in the bar (the guard would pass for nothing)`);
      });
    await signIn(page, base, locale, email, password);
    for (const from of ["/", `/${locale}`]) {
      await loadSettled(page, `${base}${from}`);
      if (pathOf(page.url()) !== `/${locale}/app`)
        problems.push(`${from} signed in: landed on ${pathOf(page.url())}, expected /${locale}/app`);
    }
    // The server answers the redirect itself: 307, private, varying with the cookie (no HTML of the landing page at all).
    const raw = await page.request.get(`${base}/${locale}`, { maxRedirects: 0 });
    if (raw.status() !== 307)
      problems.push(`/${locale} signed in: expected a 307 from the server, got ${raw.status()}`);
    if (raw.headers()["cache-control"] !== "private, no-store")
      problems.push(
        `/${locale} signed in: Cache-Control must be « private, no-store », got ${raw.headers()["cache-control"]}`,
      );
    if (!/cookie/i.test(raw.headers().vary ?? ""))
      problems.push(`/${locale} signed in: Vary must name Cookie, got ${raw.headers().vary}`);
    await loadSettled(page, `${base}/${locale}/terms`);
    await page
      .waitForFunction(() => document.querySelector("header button, nav button, header [data-state]") !== null, null, {
        timeout: 15_000,
      })
      .catch(() => {});
    if (await page.evaluate(() => globalThis.__sawSignIn))
      problems.push(`/${locale}/terms signed in: the bar drew « Sign in » for an instant`);
    await context.close();
  } finally {
    await browser.close();
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await check({
    base: arg("base", "http://localhost:3000"),
    locale: arg("locale", "fr"),
    email: process.env.E2E_EMAIL,
    password: process.env.E2E_PASSWORD,
  });
  if (problems.length) {
    console.error(`${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("signed in: / lands on the home, a public page never draws « Sign in »");
}
