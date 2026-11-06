#!/usr/bin/env node
// The live walk of the administration console (admin.verikora.com), from an address of AUTH_ALLOWED_IPS: signs in as the QA
// administrator, opens every console page in both themes on a phone and a desktop, and fails on a page that is not 200, has
// no <main>, overflows sideways, lacks the DEV badge (desktop), or logs a console error (a hydration mismatch is one).
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/check-admin-live.mjs [--base https://admin.verikora.com] [--shots <dir>]
//
// The credentials are the administrator's of company/QA.md, read without printing them:
//   ADMIN_EMAIL=$(~/.krizaka-worktrees/tools/secret.sh @qa VERIKORA_ADMIN_EMAIL) ADMIN_PASSWORD=$(… VERIKORA_ADMIN_PASSWORD) node …
// From any other address the host answers 404/403 and this script says so. Nothing but the checks is printed.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

import { auditContext, loadSettled } from "@krizaka/page-audit";

export const PAGES = [
  "",
  "/users",
  "/documents",
  "/runs",
  "/flows",
  "/flows/new",
  "/operations",
  "/incidents",
  "/audit",
];
export const VIEWS = [
  { tag: "desktop-dark", theme: "dark", viewport: { width: 1440, height: 900 } },
  { tag: "desktop-light", theme: "light", viewport: { width: 1440, height: 900 } },
  { tag: "phone-dark", theme: "dark", viewport: { width: 390, height: 844 } },
  { tag: "phone-light", theme: "light", viewport: { width: 390, height: 844 } },
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** Signs the administrator in; a problem line when the gate or the landing is not what it should be, null when signed in. */
async function signIn(page, { base, email, password, tag }) {
  const gate = await loadSettled(page, `${base}/en/sign-in`, { waitUntil: "networkidle" });
  if (!gate || gate.status() !== 200)
    return `${tag}: the sign-in answers ${gate?.status()} — run this from an address of AUTH_ALLOWED_IPS`;
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  try {
    await page.waitForURL(`${base}/en`, { timeout: 30_000 });
  } catch {
    return `${tag}: the administrator did not land on the overview (${new URL(page.url()).pathname})`;
  }
  return null;
}

/** What one page shows: the problems found on it (status, <main>, overflow, DEV badge, console error). */
async function auditPage(page, { base, path, tag, errors }) {
  const response = await loadSettled(page, `${base}/en${path}`, { waitUntil: "networkidle" });
  const state = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    main: !!document.querySelector("main"),
    dev: /DEV/.test(document.body.innerText),
  }));
  const where = `${tag} ${path || "/"}`;
  const found = [];
  if (response?.status() !== 200) found.push(`${where}: ${response?.status()}`);
  if (!state.main) found.push(`${where}: no <main>`);
  if (state.sideways) found.push(`${where}: scrolls sideways`);
  if (tag.startsWith("desktop") && !state.dev) found.push(`${where}: no DEV badge`);
  if (errors.length) found.push(`${where}: console error — ${errors[0]}`);
  return found;
}

export async function walk({ base, email, password, shots }) {
  const problems = [];
  const browser = await chromium.launch();
  for (const { tag, theme, viewport } of VIEWS) {
    const context = await auditContext(browser, { viewport, colorScheme: theme });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("kz-theme", t);
      } catch {
        /* none */
      }
    }, theme);
    const page = await context.newPage();
    let errors = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 140));
    });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
    const refused = await signIn(page, { base, email, password, tag });
    if (refused) {
      problems.push(refused);
      await context.close();
      continue;
    }
    for (const path of PAGES) {
      errors = [];
      problems.push(...(await auditPage(page, { base, path, tag, errors })));
      if (shots) {
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: join(shots, `${tag}${(path || "/overview").replace(/\//g, "-")}.png`) });
      }
    }
    await context.close();
  }
  await browser.close();
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required (see the header of this file).");
    process.exit(2);
  }
  const problems = await walk({
    base: arg("base", "https://admin.verikora.com"),
    email,
    password,
    shots: arg("shots"),
  });
  if (problems.length) {
    console.error(`${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `administration: ${PAGES.length} pages x ${VIEWS.length} views, signed in, no overflow, no console error`,
  );
}
