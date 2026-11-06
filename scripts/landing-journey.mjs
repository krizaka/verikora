#!/usr/bin/env node
// The landing's living proof: the real journey on dev.verikora.com, recorded as the QA member (never the administrator),
// one clip per step of « How it works » — keep (the library), check (a compliance check run by Sovkora, waited for, its
// findings), find (a search across the library). Run once per device; the clips go to Bunny, never into the repository.
//
//   QA_USER_EMAIL=… QA_USER_PASSWORD=… node scripts/landing-journey.mjs <out-dir> [--device phone|desktop] [--locale en|fr]
//
// Writes <out-dir>/<device>/{keep,check,find}.{webm,mp4,jpg} and <out-dir>/<device>/evidence.json (the Sovkora run id of
// the check, the times of each step). The waiting is sped up uniformly (never edited otherwise); the e-mail of the account
// is hidden on screen. Needs a Chromium for playwright-core and ffmpeg. Credentials are read from the environment, never printed.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { flagReader, hideEmail } from "./lib/recording-kit.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = flagReader(args);
const outRoot = path.resolve(args[0] ?? "journey");
const device = flag("device", "phone");
const locale = flag("locale", "en");
const BASE = process.env.APP_BASE_URL ?? "https://dev.verikora.com";
const email = process.env.QA_USER_EMAIL;
const password = process.env.QA_USER_PASSWORD;
if (!email || !password) throw new Error("QA_USER_EMAIL and QA_USER_PASSWORD are required");

/** The device's viewport: the phone matches DeviceFrame's 9:19.5 screen, the desktop its 16:10 browser. */
const VIEWPORT = device === "phone" ? { width: 390, height: 845 } : { width: 1280, height: 800 };
/** The longest a clip may last once the waiting is sped up (the three stay under a minute together). */
const MAX_SECONDS = { keep: 12, check: 22, find: 12 };
const dir = path.join(outRoot, device);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const base = {
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  colorScheme: "dark",
  locale,
  ...(device === "phone" ? { isMobile: true, hasTouch: true } : {}),
};

// Sign in once, off camera: the clips start signed in.
const auth = await browser.newContext(base);
const signIn = await auth.newPage();
await signIn.goto(`${BASE}/${locale}/sign-in`, { waitUntil: "networkidle" });
await signIn.fill('input[type="email"]', email);
await signIn.fill('input[type="password"]', password);
await signIn.locator('form button[type="submit"]').first().click();
await signIn.waitForURL(/\/app/, { timeout: 30_000 });
const storageState = await auth.storageState();
await auth.close();

const evidence = { device, locale, base: BASE, recordedAt: new Date().toISOString(), steps: {} };

/** Records one step in its own context (one video), then trims the blank start and encodes the clip. */
async function record(id, act) {
  const ctx = await browser.newContext({ ...base, storageState, recordVideo: { dir, size: VIEWPORT } });
  await ctx.addInitScript(hideEmail);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = {};
  const mark = (name) => {
    marks[name] = (Date.now() - t0) / 1000;
  };
  await act(page, mark);
  await page.waitForTimeout(1500);
  mark("end");
  const video = page.video();
  await ctx.close();
  const raw = path.join(dir, `${id}.raw.webm`);
  renameSync(await video.path(), raw);
  const start = marks.ready ?? 0;
  const real = marks.end - start;
  const speed = Math.max(1, real / MAX_SECONDS[id]);
  const vf = `setpts=PTS/${speed.toFixed(4)},fps=30`;
  const ff = (...a) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a], { stdio: "inherit" }); // NOSONAR S4036: a developer-machine script, PATH is the developer's own
  const input = ["-ss", start.toFixed(2), "-t", real.toFixed(2), "-i", raw, "-an", "-vf", vf];
  ff(...input, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", path.join(dir, `${id}.webm`));
  ff(
    ...input,
    "-c:v",
    "libx264",
    "-crf",
    "24",
    "-preset",
    "slow",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path.join(dir, `${id}.mp4`),
  );
  ff(
    "-ss",
    (start + real * (marks.poster !== undefined ? (marks.poster - start) / real : 0.9)).toFixed(2),
    "-i",
    raw,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    path.join(dir, `${id}.jpg`),
  );
  evidence.steps[id] = { marks, seconds: +(real / speed).toFixed(1), speed: +speed.toFixed(2) };
  process.stdout.write(`✓ ${device}/${id}: ${(real / speed).toFixed(1)} s (x${speed.toFixed(2)})\n`);
}

// 1 · Keep — the library: the drop zone, the documents kept, then the lease opened.
await record("keep", async (page, mark) => {
  await page.goto(`${BASE}/${locale}/app`, { waitUntil: "networkidle" });
  mark("ready");
  await page.waitForTimeout(2200);
  await page.mouse.wheel(0, 380);
  await page.waitForTimeout(1600);
  mark("poster");
  await page.waitForTimeout(800);
  await page
    .locator('a[href*="/app/documents/"]')
    .filter({ hasText: /^\s*lease\b/i })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
});

// 2 · Check — the compliance check of the lease, run by Sovkora now, waited for, then its findings.
let documentUrl = "";
await record("check", async (page, mark) => {
  await page.goto(`${BASE}/${locale}/app`, { waitUntil: "networkidle" });
  await page
    .locator('a[href*="/app/documents/"]')
    .filter({ hasText: /^\s*lease\b/i })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  documentUrl = page.url();
  await page.waitForSelector('[data-testid="sovkora-run-id"]');
  await page.waitForLoadState("networkidle");
  const runIds = () => page.locator('[data-testid="sovkora-run-id"]').allTextContents();
  const failures = () =>
    page.evaluate(() => (document.body.innerText.match(/NON-COMPLIANT|NON CONFORME/gi) ?? []).length);
  const before = new Set((await runIds()).map((s) => s.trim()));
  const failedBefore = await failures();
  const form = page
    .locator("form[aria-label]")
    .filter({ has: page.locator('[name="jurisdiction"], select') })
    .first();
  await form.scrollIntoViewIfNeeded();
  mark("ready");
  await page.waitForTimeout(1500);
  await form.locator('button[type="submit"]').click();
  mark("run");
  // The new run appears in the list (its id is the trace), polled until Sovkora answers with its findings.
  await page.waitForFunction(
    (known) =>
      [...document.querySelectorAll('[data-testid="sovkora-run-id"]')].some(
        (el) => !known.includes(el.textContent.trim()),
      ),
    [...before],
    { timeout: 120_000 },
  );
  const runId = (await runIds()).map((s) => s.trim()).find((id) => !before.has(id));
  await page.waitForFunction(
    (n) => (document.body.innerText.match(/NON-COMPLIANT|NON CONFORME/gi) ?? []).length > n,
    failedBefore,
    { timeout: 240_000 },
  );
  mark("answered");
  evidence.runId = runId;
  evidence.document = documentUrl.replace(/^https?:\/\/[^/]+/, "");
  const failing = page.getByText(/NON-COMPLIANT|NON CONFORME/i).first();
  await failing.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy({ top: -120, behavior: "smooth" }));
  await page.waitForTimeout(2200);
  mark("poster");
  await page.waitForTimeout(1200);
});

// 3 · Find — a word across every document and every finding.
await record("find", async (page, mark) => {
  await page.goto(`${BASE}/${locale}/app/search`, { waitUntil: "networkidle" });
  mark("ready");
  await page.waitForTimeout(1000);
  const box = page.locator('input[type="search"], input').first();
  await box.click();
  await box.pressSequentially("dépôt", { delay: 160 });
  await box.press("Enter");
  await page.waitForTimeout(2600);
  mark("poster");
  await page.waitForTimeout(1200);
});

await browser.close();
writeFileSync(path.join(dir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`run ${evidence.runId ?? "—"} · ${dir}\n`);
