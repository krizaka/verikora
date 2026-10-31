#!/usr/bin/env node
// The signed-in pages, rendered in a real browser as the seeded persona (never a real account): every app page has exactly
// one h1, no horizontal overflow at 360, 390, 1280, 1440 and 1600 px in both themes, no card out of its panel, no section covering another, no column cut off (yomizaka#435), no unnamed button, the header's one action on
// screen and named, no console error (the UX review of October 2026, Y1).
//
//   E2E_EMAIL=… E2E_PASSWORD=… node scripts/check-app-pages.mjs --base http://localhost:3000 [--locale fr] [--shots <dir>]
//
// The fixed pages are below; a collection and a document (its checks and its information) are found from the library.
// Exits 1 listing every page × width × theme with a problem. With --shots it also writes a screenshot of each.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { A11yCollector, auditPage as auditA11y, finish } from "@krizaka/a11y-audit";
import { chromium } from "playwright-core";

import { auditPage, problemsOf, auditContext, loadSettled, resizeSettled } from "@krizaka/page-audit";

import { demoOwnerTokens } from "./demo-seed/seed.mjs";

export const WIDTHS = [360, 390, 1280, 1440, 1600];
export const THEMES = ["dark", "light"];
// axe-core (WCAG 2.1 AA) runs at the phone and the desktop width only: a finding is counted once per route, theme and node.
export const A11Y_WIDTHS = [390, 1440];
export const A11Y_BASELINE = fileURLToPath(new URL("../a11y-baseline.app.json", import.meta.url));
export const PAGES = [
  "/app",
  "/app/documents",
  "/app/dossiers",
  "/app/screening",
  "/app/check",
  "/app/verifications",
  "/app/verifications?tab=lots",
  "/app/verifications?q=bail&result=attention,checked&kind=lease&period=year",
  "/app/search",
  "/app/settings/profil",
  "/app/settings/apparence",
  "/app/settings/securite",
  "/app/settings/facturation",
  "/app/settings/stockage",
  "/app/settings/donnees",
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** Signs in through the form, as a person would; the session cookie then carries the context. */
export async function signIn(page, base, locale, email, password) {
  await loadSettled(page, `${base}/${locale}/sign-in`);
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(password);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/app(\/|\?|$)/, { timeout: 60_000 });
}

/**
 * The routes of the sidebar (the `nav` of the shell), without their query and language: a page the rail offers is a page that is
 * audited, so a new section is never forgotten (« Dossiers » was, and crashed unseen, yomizaka#457). Pure, tested.
 */
export function railRoutes(hrefs, locale) {
  const escaped = locale.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const own = new RegExp(`^/${escaped}(/app(?:/[^?#]*)?)(?:[?#].*)?$`);
  return [...new Set(hrefs.map((h) => own.exec(h ?? "")?.[1]).filter(Boolean))].map(
    (p) => p.replace(/\/$/, "") || "/app",
  );
}

/** The pages to visit: the fixed list, the rail's routes, then one collection and one document found on the library (their tabs). */
export async function discover(page, base, locale) {
  await loadSettled(page, `${base}/${locale}/app`);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const rail = await page.$$eval("nav a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const found = railRoutes(rail, locale).filter((p) => !PAGES.includes(p));
  const collection = hrefs.find((h) => /\/app\/library\/[^/]+\/[^/]+$/.test(h ?? ""));
  if (collection) found.push(collection.replace(/^\/(en|fr)/, ""));
  // Every tab of the binder, the empty folders included: the open folder's card is audited in each state (yomizaka#435).
  for (const h of new Set(hrefs.filter((x) => /[?&]collection=/.test(x ?? ""))))
    found.push(h.replace(/^\/(en|fr)/, ""));
  // The applicant file's page (it carries the owner-link block, yomizaka#128).
  await loadSettled(page, `${base}/${locale}/app/dossiers`);
  const dossier = (await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))).find((h) =>
    /\/app\/dossiers\/[0-9a-f-]{36}$/.test(h ?? ""),
  );
  if (dossier) found.push(dossier.replace(/^\/(en|fr)/, ""));
  const document = hrefs.find((h) => /\/app\/documents\/[^/]+(\/|$)/.test(h ?? ""));
  if (document) {
    const id = document.match(/\/app\/documents\/([^/?#]+)/)[1];
    found.push(`/app/documents/${id}/rapport`, `/app/documents/${id}/document`);
  }
  return [...new Set([...PAGES, ...found])];
}

/** The public owner report (yomizaka#128) opens on the seeded demo token, and the revoked demo token answers 404 (never the report). */
export const ownerReportPath = (persona = "eric") => `/rapport/${demoOwnerTokens(persona).live}`;
export const revokedReportPath = (persona = "eric") => `/rapport/${demoOwnerTokens(persona).revoked}`;

/** The home's primary action as the page reads it: the `data-testid` element, its role, name and place on the first screen. */
export const homePrimaryInfo = () => {
  const el = document.querySelector("[data-testid='home-check-button']");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    role: el.getAttribute("role") ?? (el.tagName === "A" ? "link" : el.tagName.toLowerCase()),
    name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
    visible: r.width > 0 && r.height > 0,
    inFirstScreen: r.top >= 0 && r.bottom <= window.innerHeight,
  };
};

/** The home's first screen offers « Check a document » as a button (krizaka-internal#2001), visible without scrolling; pure, tested. */
export function homePrimaryProblems(where, info, label) {
  if (!info) return [`${where}: no primary « ${label} » button on the home`];
  const found = [];
  if (!info.visible || !info.inFirstScreen)
    found.push(`${where}: the primary « ${label} » button is not on the first screen`);
  if (info.name !== label) found.push(`${where}: the primary button is named « ${info.name} », not « ${label} »`);
  if (!["link", "button"].includes(info.role))
    found.push(`${where}: the primary action is a ${info.role}, not a button`);
  return found;
}

const HOME_LABEL = { en: "Check a document", fr: "Vérifier un document" };

/** One page at one width in one theme: the audit's problems, the axe findings recorded, the optional screenshot. */
async function auditAt({ page, path, width, theme, base, locale, shots, a11y, errors }) {
  const publicPage = path.startsWith("/rapport/");
  await resizeSettled(page, { width, height: width < 600 ? 844 : 900 });
  await loadSettled(page, `${base}/${locale}${path}`);
  await page.waitForTimeout(300);
  const result = await page.evaluate(auditPage);
  const where = `${publicPage ? "/rapport/<demo token>" : path} @${width} ${theme}`;
  // The home (/app) has no header "+": its one primary action is the drop zone itself (journey home-check-and-dossiers).
  const found = problemsOf(where, result, { errors, h1: true, headerAction: !publicPage && path !== "/app" });
  if (path === "/app")
    found.push(...homePrimaryProblems(where, await page.evaluate(homePrimaryInfo), HOME_LABEL[locale]));
  if (A11Y_WIDTHS.includes(width))
    a11y.add({ route: publicPage ? "/rapport/<demo token>" : path, theme }, await auditA11y(page));
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({
      path: join(shots, `${path.replace(/[^a-z0-9]+/gi, "_")}-${width}-${theme}.png`),
      fullPage: false,
    });
  }
  return found;
}

/** One theme's pass over every page at every width: the problems found (one console collector per page). */
async function auditTheme({ browser, theme, cookies, pages, base, locale, shots, a11y }) {
  const problems = [];
  const ctx = await auditContext(browser, { colorScheme: theme });
  await ctx.addCookies(cookies);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("kz-theme", t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 140));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  for (const path of [...pages, ownerReportPath()]) {
    for (const width of WIDTHS) {
      problems.push(...(await auditAt({ page, path, width, theme, base, locale, shots, a11y, errors })));
      errors.length = 0;
    }
  }
  await ctx.close();
  return problems;
}

export async function check({ base, locale = "fr", email, password, shots }) {
  if (!email || !password) throw new Error("E2E_EMAIL and E2E_PASSWORD are required (the seeded persona)");
  const browser = await chromium.launch();
  const problems = [];
  const a11y = new A11yCollector("yomizaka-app");
  try {
    const context = await auditContext(browser, { viewport: { width: 1440, height: 900 } });
    const probe = await context.newPage();
    await signIn(probe, base, locale, email, password);
    const pages = await discover(probe, base, locale);
    const revoked = await probe.request.get(`${base}/${locale}${revokedReportPath()}`);
    if (revoked.status() !== 404)
      problems.push(`${revokedReportPath()}: a revoked link must answer 404, got ${revoked.status()}`);
    // The signed PDF of the owner report (yomizaka#481): a PDF on the live link, nothing on the revoked one.
    const pdf = await probe.request.get(`${base}/api/rapport/${demoOwnerTokens("eric").live}/pdf?locale=${locale}`);
    if (pdf.status() !== 200 || !String(pdf.headers()["content-type"]).startsWith("application/pdf"))
      problems.push(`/api/rapport/<demo token>/pdf: expected a PDF, got ${pdf.status()}`);
    const noPdf = await probe.request.get(`${base}/api/rapport/${demoOwnerTokens("eric").revoked}/pdf`);
    if (noPdf.status() !== 404)
      problems.push(`/api/rapport/<revoked token>/pdf: a revoked link must answer 404, got ${noPdf.status()}`);
    await probe.close();
    const cookies = await context.cookies();
    await context.close();
    for (const theme of THEMES)
      problems.push(...(await auditTheme({ browser, theme, cookies, pages, base, locale, shots, a11y })));
    const guard = finish(a11y, { baseline: A11Y_BASELINE });
    for (const note of guard.notes) console.log(note);
    problems.push(...guard.problems);
    return { problems, pages: [...pages, ownerReportPath()] };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, pages } = await check({
    base: arg("base", "http://localhost:3000"),
    locale: arg("locale", "fr"),
    email: process.env.E2E_EMAIL,
    password: process.env.E2E_PASSWORD,
    shots: arg("shots"),
  });
  if (problems.length) {
    console.error(`${problems.length} problem(s) on the signed-in pages:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `signed-in pages: one h1 each, no overflow, the header's action on screen — ${pages.length} pages x ${WIDTHS.length} widths x ${THEMES.length} themes`,
  );
}
