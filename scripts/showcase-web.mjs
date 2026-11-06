#!/usr/bin/env node
// The web showcase journeys of the download page (krizaka/.github#315): short recordings made by the e2e job itself, so the
// videos follow the product. Two journeys, on the seeded demo persona Éric (CI) or the dev QA member (never the administrator):
//   web-binder  sign in (on camera in CI: the persona's address is a demo one), the library, the binder (collections), a collection.
//   web-report  a document of the library, then its signed report.
// « Run a check » needs the Sovkora engine, which the CI backend does not have: that step is the landing's `check` clip
// (scripts/landing-journey.mjs, on dev). Nothing personal is on screen: the e-mail shown in the app is hidden, the password
// is a field of dots, the development banner is hidden (showcase mode, verikora#1968).
//
//   E2E_EMAIL=… E2E_PASSWORD=… node scripts/showcase-web.mjs <out-dir> [--base http://localhost:3000] [--locale en|fr] [--sign-in camera|off]
//
// Writes <out-dir>/web-binder-<locale>.webm and web-report-<locale>.webm (no audio is recorded) with their markers JSON (what was on
// screen at each step: language, error, empty state, banner, result: scripts/film-trim.mjs refuses a film they condemn), ready for the
// app-videos action. Run it once per language, on a database seeded in that language (demo-seed --cast --locale <en|fr>).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { probe } from "./film-markers-lib.mjs";
import { applyTheme, flagReader, hideEmail, themesOf } from "./lib/recording-kit.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = flagReader(args);
const outDir = path.resolve(args[0] ?? "showcase-web");
const base = flag("base", "http://localhost:3000");
const locale = flag("locale", "en");
const signInMode = flag("sign-in", "camera");
const [theme] = themesOf(flag("theme", "dark")); // a video is one theme; run it twice for both
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password)
  throw new Error("E2E_EMAIL and E2E_PASSWORD are required (the seeded persona, never a real account)");
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };
const browser = await chromium.launch();

async function signIn(page, { slow }) {
  await page.goto(`${base}/${locale}/sign-in`, { waitUntil: "networkidle" });
  if (slow) await page.waitForTimeout(800);
  const delay = slow ? 70 : 0;
  await page.locator("input[type=email]").first().pressSequentially(email, { delay });
  await page.locator("input[type=password]").first().pressSequentially(password, { delay });
  if (slow) await page.waitForTimeout(500);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/app(\/|\?|$)/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
}

/** Signed-in state, made off camera, for the journeys that start inside the app. */
async function session() {
  const ctx = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, locale });
  await applyTheme(ctx, theme);
  const page = await ctx.newPage();
  await signIn(page, { slow: false });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Showcase mode: the development notice (« data can be reset ») is not part of a film; the marker probe checks it stayed hidden. */
const SHOWCASE_CSS = "[data-top-chrome]{display:none !important}";

/** One journey = one context = one video; the file is renamed <id>-<locale>.webm in the out directory, with its markers. */
async function record(id, act, storageState, resultSelector) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: theme,
    locale,
    storageState,
    recordVideo: { dir: outDir, size: VIEWPORT },
  });
  await applyTheme(ctx, theme);
  await ctx.addInitScript(hideEmail);
  await ctx.addInitScript((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    });
  }, SHOWCASE_CSS);
  const page = await ctx.newPage();
  const frames = [];
  const mark = async () => frames.push(await page.evaluate(probe, resultSelector));
  await act(page, mark);
  await page.waitForTimeout(1500);
  await mark();
  const video = page.video();
  await ctx.close();
  const film = `${id}-${locale}`;
  renameSync(await video.path(), path.join(outDir, `${film}.webm`));
  writeFileSync(path.join(outDir, `${film}.markers.json`), JSON.stringify({ frames }, null, 2));
  process.stdout.write(`recorded ${film}\n`);
}

const firstDocument = (page) => page.locator('a[href*="/app/documents/"]').first();

const off = signInMode === "off" ? await session() : undefined;

/**
 * The home lists the dossiers (collections and applicant files); the account's default collection is empty in the demo data, the demo
 * files are in the named ones. The film opens the dossier that holds the demo leases, never the first row (which may be the empty default
 * collection: the marker guard refuses an empty state, run 41185385772, and stays as strict as it was).
 */
const DEMO_COLLECTION = /Rosemont/;
const dossierRow = (page) =>
  page.locator('[data-testid="home-dossiers"] a[href*="/app/library/"]').filter({ hasText: DEMO_COLLECTION }).first();

await record(
  "web-binder",
  async (page, mark) => {
    if (signInMode === "camera") await signIn(page, { slow: true });
    else await page.goto(`${base}/${locale}/app`, { waitUntil: "networkidle" });
    // The home: the dossiers, the demo leases among them.
    await dossierRow(page).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1800);
    await page.mouse.wheel(0, 360);
    await page.waitForTimeout(1600);
    await mark();
    // The dossier with the demo leases: its own page.
    const row = dossierRow(page);
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await row.click();
    await page.locator('a[href*="/app/documents/"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2600);
    await mark();
  },
  off,
  'a[href*="/app/documents/"]',
);

const state = off ?? (await session());
// Which document to open is looked for off camera, so the recorded film starts on its report.
const reportPath = await (async () => {
  const ctx = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark", locale, storageState: state });
  const page = await ctx.newPage();
  await page.goto(`${base}/${locale}/app`, { waitUntil: "networkidle" });
  // The home lists dossiers, not documents (#680): open the one with the demo leases, then its first document.
  await dossierRow(page).click();
  await firstDocument(page).waitFor({ timeout: 30_000 });
  await firstDocument(page).click();
  // The click starts a client navigation: the URL changes some time later, so wait for it (reading it at once saw the library, 29-30 Oct).
  await page.waitForURL(/\/app\/documents\/[^/?#]+/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const href = /\/app\/documents\/[^/?#]+/.exec(new URL(page.url()).pathname)?.[0];
  await ctx.close();
  if (!href) throw new Error("no document in the library: the demo data is missing");
  return href;
})();
await record(
  "web-report",
  async (page, mark) => {
    // The poster is the frame at 2 s (verikora#575): the film opens ON the report, not on the library it is reached from.
    await page.goto(`${base}/${locale}${reportPath}/rapport`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2200);
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(2000);
    await mark();
  },
  state,
  "main h1",
);

await browser.close();
