#!/usr/bin/env node
// The home's first screen (the UX review's Y9 — F6, F8): the page starts 24 px under the fixed bar (no void above the hero), and
// at 390 × 844 the product's visual is inside the first screen, and no two blocks of the top chrome (the notice, the fixed bar) overlap
// at 390, 1280 and 1600 px (verikora#449) — both languages, both themes, in a real browser.
//
//   node scripts/check-home-first-screen.mjs --base http://localhost:3000
//
// Exits 1 listing every page × viewport × theme with a problem.
import { chromium } from "playwright-core";

import { auditPage, auditContext, loadSettled } from "@krizaka/page-audit";

// @fixed: the gap between the bar and the page (`--kz-hero-top` = the bar's bottom + this), the family's « One frame for every page »
export const GAP_PX = 24;
export const TOLERANCE_PX = 6;
export const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];
export const PAGES = ["/fr", "/en"];
export const THEMES = ["dark", "light"];

/** Runs in the page: the bar's bottom (the bar stands below the notice of a non-production deployment), where the hero's frame starts drawing (its padding box), the visual's top and whether it clips its text. */
export const MEASURE = `(() => {
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const bar = rect(document.querySelector("[data-site-bar] > *") ?? document.querySelector("nav"));
  const frame = document.querySelector("main .kz-hero > .kz-frame") ?? document.querySelector("main");
  const contentTop = frame ? frame.getBoundingClientRect().top + parseFloat(getComputedStyle(frame).paddingTop) : null;
  const visual = document.querySelector('[data-testid="home-visual"]');
  const bottom = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().bottom : null; };
  return { h1Bottom: bottom("main h1"), primaryBottom: bottom('[data-testid="hero-primary"]'), articleBottom: bottom('[data-testid="hero-article"]'), barBottom: bar ? bar.bottom : null, contentTop, showcaseTop: visual ? visual.getBoundingClientRect().top : null, visualClipped: visual ? visual.scrollHeight > visual.clientHeight + 1 : null };
})()`;

/** A pixel position in words: rounded, or « none » when the element was not found. */
const px = (value) => (value == null ? "none" : Math.round(value));

/** The phone's first screen: the product's visual, then the five-second assertion (krizaka-internal#2562): the promise, the one action
 * and the finding's article are all within the first screen. */
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
    ["the finding's article", m.articleBottom],
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
    return [`${where}: no bar or no hero frame`];
  }
  const out = [];
  // The bar clears the top chrome (the notice of a non-production deployment): it stands below it, so the 24 px are counted from the
  // bar's bottom, never loosened — and an overlap of the two is its own problem below (verikora#449).
  const gap = m.contentTop - m.barBottom;
  if (Math.abs(gap - GAP_PX) > TOLERANCE_PX) {
    out.push(`${where}: the page starts ${Math.round(gap)} px under the bar, not ${GAP_PX}`);
  }
  out.push(...phoneProblems(m, where));
  if ((m.chromeOverlaps ?? []).length) {
    out.push(`${where}: the top chrome chromeOverlaps (${m.chromeOverlaps.slice(0, 2).join(", ")})`);
  }
  if (m.visualClipped) {
    out.push(`${where}: the product's visual clips its text (the finding and its article must stay readable)`);
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
    `home first screen: the page 24 px under the bar, the product on a phone's first screen — ${PAGES.length} pages x ${VIEWPORTS.length} viewports x ${THEMES.length} themes`,
  );
}
