#!/usr/bin/env node
// The home's first screen (the UX review's Y9 — F6, F8), on the product-page template of @krizaka/ui (krizaka-internal#4634): the hero's
// text starts under the fixed bar, within the template's own spacing (never hidden by it, never a void), and at 390 × 844 the stage
// of the product (the flagged lease clause) is inside the first screen, and no two blocks of the top chrome (the notice, the fixed bar) overlap
// at 390, 1280 and 1600 px (verikora#449) — both languages, both themes, in a real browser.
//
//   node scripts/check-home-first-screen.mjs --base http://localhost:3000
//
// Exits 1 listing every page × viewport × theme with a problem.
import { chromium } from "playwright-core";

import { auditPage, auditContext, loadSettled } from "@krizaka/page-audit";

// The most the template leaves between the bar's bottom and the hero's text (it centres the text in its hero: 44 px on a phone, 76 px
// on a desktop); more is a void.
export const GAP_MAX_PX = 96;
export const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];
export const PAGES = ["/fr", "/en"];
export const THEMES = ["dark", "light"];

/** Runs in the page: the bar's bottom (the bar stands below the notice of a non-production deployment), where the hero's text starts, the stage's top, the H1's and the primary action's bottom. */
export const MEASURE = `(() => {
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const bar = rect(document.querySelector("[data-site-bar] > *") ?? document.querySelector("nav"));
  const text = rect(document.querySelector("main .kz-pp-hero-text"));
  const stage = rect(document.querySelector("main .kz-pp-stage"));
  const bottom = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().bottom : null; };
  return { h1Bottom: bottom("main h1"), primaryBottom: bottom("main .kz-pp-actions a"), barBottom: bar ? bar.bottom : null, contentTop: text ? text.top : null, showcaseTop: stage ? stage.top : null };
})()`;

/** A pixel position in words: rounded, or « none » when the element was not found. */
const px = (value) => (value == null ? "none" : Math.round(value));

/** The phone's first screen: the product's stage, then the five-second assertion (krizaka-internal#2562): the promise and the one action
 * are within the first screen. */
function phoneProblems(m, where) {
  if (m.width >= 600) {
    return [];
  }
  const out = [];
  if (m.showcaseTop === null || m.showcaseTop >= m.height) {
    out.push(`${where}: the product's visual is not on the first screen (top ${px(m.showcaseTop)} of ${m.height})`);
  }
  const fiveSeconds = [
    ["the H1", m.h1Bottom],
    ["the primary action", m.primaryBottom],
  ];
  for (const [name, bottom] of fiveSeconds) {
    if (bottom == null || bottom > m.height) {
      out.push(`${where}: ${name} is not within the first ${m.height} px (bottom ${px(bottom)})`);
    }
  }
  return out;
}

/** The problems of one measure, in words. */
export function problemsOf(m) {
  const where = `${m.path} @${m.width} ${m.theme}`;
  if (m.barBottom === null || m.contentTop === null) {
    return [`${where}: no bar or no hero text`];
  }
  const out = [];
  // The bar clears the top chrome (the notice of a non-production deployment): the gap is counted from the bar's bottom, and an overlap
  // of the two is its own problem below (verikora#449).
  const gap = m.contentTop - m.barBottom;
  if (gap < 0) {
    out.push(`${where}: the hero's text starts ${Math.round(-gap)} px above the bar's bottom, under it`);
  } else if (gap > GAP_MAX_PX) {
    out.push(`${where}: a void of ${Math.round(gap)} px under the bar, before the hero's text`);
  }
  out.push(...phoneProblems(m, where));
  if ((m.chromeOverlaps ?? []).length) {
    out.push(`${where}: the top chrome chromeOverlaps (${m.chromeOverlaps.slice(0, 2).join(", ")})`);
  }
  return out;
}

export async function check({ base }) {
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        const ctx = await auditContext(browser, { viewport, colorScheme: theme });
        await ctx.addInitScript((t) => {
          try {
            localStorage.setItem("kz-theme", t);
          } catch {
            /* nothing kept */
          }
        }, theme);
        const page = await ctx.newPage();
        for (const path of PAGES) {
          await loadSettled(page, `${base}${path}`, { waitUntil: "networkidle", timeout: 90000 });
          const m = await page.evaluate(MEASURE);
          const { chromeOverlaps } = await page.evaluate(auditPage);
          problems.push(...problemsOf({ ...m, chromeOverlaps, path, theme, ...viewport }));
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  return problems;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const i = process.argv.indexOf("--base");
  const base = i >= 0 ? process.argv[i + 1] : "http://localhost:3000";
  const problems = await check({ base });
  for (const p of problems) console.error(`check-home-first-screen: ${p}`);
  if (problems.length) process.exit(1);
  console.log(
    `home first screen: the hero's text under the bar, the product's stage on a phone's first screen — ${PAGES.length} pages x ${VIEWPORTS.length} viewports x ${THEMES.length} themes`,
  );
}
