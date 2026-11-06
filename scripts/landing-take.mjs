#!/usr/bin/env node
// « Du fichier au constat » — the landing's recorded journey as ONE smooth take, phone first (390×844 at 2×): drop the
// lease → the check runs → the finding with its line lit → search. Recorded for real on dev.verikora.com as the QA member
// (never the administrator, the e-mail hidden), in the language asked; the clip goes to Bunny, never into the repository.
//
//   VERIKORA_USER_EMAIL=… VERIKORA_USER_PASSWORD=… node scripts/landing-take.mjs <out-dir> --locale fr|en
//
// Writes <out-dir>/<locale>/take.{webm,mp4,jpg} and evidence.json (the Sovkora run id, the chapter times). The waiting is
// sped up uniformly (never edited otherwise) to keep the take under 25 s. Needs a Chromium for playwright-core and ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { applyTheme, themesOf } from "./lib/recording-kit.mjs";
import { byTestId } from "./lib/check-selectors.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const outRoot = path.resolve(args[0] ?? "take");
const locale = flag("locale", "fr");
const [theme] = themesOf(flag("theme", "dark")); // a video is one theme; run it twice for both
const BASE = process.env.APP_BASE_URL ?? "https://dev.verikora.com";
const email = process.env.VERIKORA_USER_EMAIL;
const password = process.env.VERIKORA_USER_PASSWORD;
if (!email || !password) throw new Error("VERIKORA_USER_EMAIL and VERIKORA_USER_PASSWORD are required");

const VIEWPORT = { width: 390, height: 844 };
const SCALE = 2;
const MAX_SECONDS = 25;
const MIN_FPS = 25;
const dir = path.join(outRoot, locale);
mkdirSync(dir, { recursive: true });

// The sample lease the take drops: fictitious parties, unique bytes per take (a new document every time).
const stamp = new Date().toISOString();
const lease = `BAIL DE LOGEMENT — 4½, rue Saint-Denis, Montréal (exemple fictif)
Entre le locateur Monsieur Marc Tremblay (fictif), domicilié à Montréal,
et la locataire Madame Sophie Gagnon (fictif).
Durée : 12 mois, du 1er juillet 2026 au 30 juin 2027.
Loyer mensuel : 1 450 $, payable le premier jour du mois.
La locataire verse un dépôt de sécurité de 1 450 $ à la signature.
La locataire remet douze chèques postdatés.
Il est interdit d'avoir des enfants dans le logement.
Enregistré le ${stamp}.
`;
const file = path.join(os.tmpdir(), "bail-exemple-fictif.txt");
(await import("node:fs")).writeFileSync(file, lease);

const browser = await chromium.launch();
const base = {
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  colorScheme: theme,
  locale,
  isMobile: true,
  hasTouch: true,
};

// Sign in once, off camera, and choose a side so the onboarding card does not cover the library.
const auth = await browser.newContext(base);
const signIn = await auth.newPage();
await signIn.goto(`${BASE}/${locale}/sign-in`, { waitUntil: "networkidle" });
await signIn.fill('input[type="email"]', email);
await signIn.fill('input[type="password"]', password);
await signIn.locator('form button[type="submit"]').first().click();
await signIn.waitForURL(/\/app/, { timeout: 30_000 });
await auth.request.put(`${BASE}/api/me/perspective`, { data: { perspective: "tenant" } });
const storageState = await auth.storageState();
await auth.close();

const hideEmail = () => {
  const hide = () => {
    for (const el of document.querySelectorAll("body *"))
      if (el.childElementCount === 0 && /@[a-z0-9.-]+\.[a-z]{2,}/i.test(el.textContent ?? ""))
        el.style.visibility = "hidden";
  };
  document.addEventListener("DOMContentLoaded", () => {
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
};

const ctx = await browser.newContext({ ...base, storageState });
await applyTheme(ctx, theme);
await ctx.addInitScript(hideEmail);
const page = await ctx.newPage();
// Playwright's recorder and the protocol's screencast film a phone in CSS pixels (a 390 px page would be blurry), and
// page.screenshot() manages about 12 frames a second. A raw Page.captureScreenshot (optimizeForSpeed, JPEG) returns the
// device's real pixels (390×844 at 2× = 780×1688) at 25+ frames a second: frames are taken in a tight loop, each with its
// wall-clock time, and assembled afterwards. The take is refused below 25 fps on average.
const cdp = await ctx.newCDPSession(page);
const capture = async () => {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression: "[visualViewport.pageLeft, visualViewport.pageTop]",
    returnByValue: true,
  });
  const [x, y] = result.value;
  return cdp.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 85,
    optimizeForSpeed: true,
    clip: { x, y, width: VIEWPORT.width, height: VIEWPORT.height, scale: SCALE },
  });
};
const frames = [];
let filming = true;
// Two capture loops in flight: a frame at 780×1688 takes ~40 ms to come back, and one loop alone filmed 22 fps on a busy machine.
const filmLoop = async () => {
  while (filming) {
    const at = Date.now() / 1000;
    // A capture that never answers (the page is navigating) must not stall the take: give up after 3 s and go on.
    // The capture comes back at CSS pixels unless it is a clip with a scale; the clip is the VISUAL viewport as it is now (a
    // clip fixed at y=0 left a blank band over a scrolled page, #602), asked for at the device's scale (390×844 → 780×1688).
    const shot = await Promise.race([capture(), new Promise((r) => setTimeout(r, 3000, null))]).catch(() => null);
    if (shot) frames.push({ at, data: shot.data });
  }
};
const film = Promise.all([filmLoop(), filmLoop()]);
const RUN_LABEL = { en: /Run the check/i, fr: /Lancer la v[ée]rification/i };
const t0 = Date.now();
const marks = {};
const mark = (name) => {
  marks[name] = (Date.now() - t0) / 1000;
  console.log(`[take ${locale}] ${name} at ${marks[name].toFixed(1)}s`);
};
const waiting = (what) =>
  console.log(`[take ${locale}] waiting for ${what} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// 1 · the library, then « Vérifier un document »: the check page, the lease dropped.
await page.goto(`${BASE}/${locale}/app`, { waitUntil: "networkidle" });
mark("ready");
await page.waitForTimeout(1400);
await page.goto(`${BASE}/${locale}/app/check`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
mark("drop");
// The document is deleted after its check unless « Keep my documents » is ticked, and that choice is read when the file leaves:
// « Vérifier un document » asks it BEFORE the drop, in its folded defaults (so the lit line can show in the document).
await page.locator(`${byTestId("defaults")} summary`).click();
const keepBox = page.locator(`${byTestId("keep")} #keep-documents, ${byTestId("keep")} [role="checkbox"]`).first();
await keepBox.waitFor({ timeout: 10_000 });
if ((await keepBox.getAttribute("aria-checked")) !== "true" && !(await keepBox.isChecked().catch(() => false)))
  await keepBox.click();
await page.setInputFiles('input[type="file"]', file);
// 2 · the file lands; if Verikora is unsure it asks « Which document? » (CheckView's `kind-choice` radiogroup, as CheckView.test
// reads it): the lease is named and the check starts on its report. A file recognised for sure opens its report by itself.
const reportUrl = /\/app\/documents\/[^/]+\/rapport/;
const asked = page.locator(byTestId("kind"));
await Promise.race([asked.waitFor({ timeout: 40_000 }), page.waitForURL(reportUrl, { timeout: 40_000 })]).catch(
  () => undefined,
);
if (await asked.isVisible().catch(() => false)) {
  await page.waitForTimeout(900);
  await asked.getByRole("radio").first().click();
}
await page.waitForURL(reportUrl, { timeout: 45_000 }).catch(async (e) => {
  console.error(page.url(), (await page.locator("main").innerText()).slice(-900));
  throw e;
});
await page.waitForLoadState("networkidle");
mark("check");
// The report waits for « Run the check » (the jurisdiction and the date are the page's defaults).
await page.getByRole("button", { name: RUN_LABEL[locale] }).first().click();
waiting("the Sovkora run id (150 s max)");
await page.waitForSelector(byTestId("runId"), { state: "attached", timeout: 150_000 }).catch(async (e) => {
  await page.screenshot({ path: `${outRoot}/debug-${locale}.png` }).catch(() => undefined);
  writeFileSync(`${outRoot}/debug-${locale}.txt`, await page.locator("main").innerText());
  throw e;
});
const runId = (await page.locator(byTestId("runId")).first().textContent()).trim();
// The finding lights its line in the file only once it is selected (« See in the file »).
await page
  .getByRole("button", { name: /See in the file|Voir dans le fichier/ })
  .first()
  .click({ timeout: 30_000 })
  .catch(() => undefined);
waiting("a lit line, a <mark> in the document (60 s max)");
const lit = await page
  .waitForFunction(() => document.querySelectorAll("mark").length > 0, null, { timeout: 60_000 })
  .then(() => true)
  .catch(() => false);
console.log(`[take ${locale}] lit line: ${lit}; page ${page.url()}`);
if (!lit) {
  await page.screenshot({ path: `${outRoot}/nomark-${locale}.png` }).catch(() => undefined);
  writeFileSync(`${outRoot}/nomark-${locale}.txt`, await page.locator("main").innerText());
}
// 3 · the finding, with the line lit in the document.
mark("finding");
await page.waitForTimeout(900);
await page
  .locator("mark")
  .first()
  .scrollIntoViewIfNeeded()
  .catch(() => undefined);
await page.waitForTimeout(3800);
mark("poster");
// 4 · search.
await page.goto(`${BASE}/${locale}/app/search`, { waitUntil: "networkidle" });
mark("search");
await page.waitForTimeout(700);
const box = page.locator('input[type="search"], input').first();
await box.click();
await box.pressSequentially("dépôt", { delay: 150 });
await box.press("Enter");
await page.waitForTimeout(2600);
mark("end");
filming = false;
await film;
frames.sort((a, b) => a.at - b.at);
// Leave the QA library as found: the documents this take created are deleted (they are all « bail exemple fictif »).
const mine = await ctx.request.get(`${BASE}/api/documents`);
for (const d of (await mine.json()).documents ?? [])
  if (/^bail exemple fictif/i.test(d.title)) await ctx.request.delete(`${BASE}/api/documents/${d.id}`);
await ctx.close();
await browser.close();

// Frames → one constant-rate file (the frames come at the page's own pace): a concat list with each frame's duration.
const raw = path.join(dir, "take.raw.mp4");
const tmp = mkdtempSync(path.join(os.tmpdir(), "take-frames-"));
const list = [];
frames.forEach((f, i) => {
  const name = path.join(tmp, `${String(i).padStart(5, "0")}.jpg`);
  writeFileSync(name, Buffer.from(f.data, "base64"));
  const next = frames[i + 1]?.at ?? f.at + 0.04;
  list.push(`file '${name}'`, `duration ${Math.max(0.001, next - f.at).toFixed(4)}`);
});
const lastFrame = path.join(tmp, `${String(frames.length - 1).padStart(5, "0")}.jpg`);
list.push(`file '${lastFrame}'`);
writeFileSync(path.join(tmp, "list.txt"), `${list.join("\n")}\n`);
const ffmpegArgs = [
  "-y",
  "-v",
  "error",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  path.join(tmp, "list.txt"),
  "-vf",
  "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2",
  "-c:v",
  "libx264",
  "-crf",
  "12",
  "-preset",
  "fast",
  "-pix_fmt",
  "yuv420p",
  raw,
];
execFileSync("ffmpeg", ffmpegArgs, { stdio: "inherit" }); // NOSONAR S4036: a developer-machine script, PATH is the developer's own
const probeArgs = [
  "-v",
  "error",
  "-select_streams",
  "v:0",
  "-show_entries",
  "stream=width,height",
  "-of",
  "csv=p=0",
  raw,
];
const probed = execFileSync("ffprobe", probeArgs) // NOSONAR S4036: a developer-machine script, PATH is the developer's own
  .toString()
  .trim()
  .replace(/,+$/, ""); // NOSONAR S4036: a developer-machine script
if (probed !== `${VIEWPORT.width * SCALE},${VIEWPORT.height * SCALE}`)
  throw new Error(
    `the take is ${probed}, expected ${VIEWPORT.width * SCALE}x${VIEWPORT.height * SCALE}: refused (public video must be crisp)`,
  );
// The raw file starts at the first frame: shift every mark onto its clock.
const shift = frames[0].at - t0 / 1000;
for (const k of Object.keys(marks)) marks[k] -= shift;
const start = marks.ready;
const real = marks.end - start;
// The wait for the check (Sovkora reading) is sped up; the rest plays at its own pace. Never cut otherwise.
const waitFrom = marks.check + 1.6 - start;
const waitTo = marks.finding - start;
const WAIT_SPEED = Math.max(1, (waitTo - waitFrom) / 3);
const segs = [
  [0, waitFrom, 1],
  [waitFrom, waitTo, WAIT_SPEED],
  [waitTo, real, 1],
];
const total = segs.reduce((n, [x, y, k]) => n + (y - x) / k, 0);
const ff = (...a) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a], { stdio: "inherit" }); // NOSONAR S4036: a developer-machine script, PATH is the developer's own
const trims = segs
  .map(
    ([x, y, k], i) =>
      `[0:v]trim=start=${(start + x).toFixed(3)}:end=${(start + y).toFixed(3)},setpts=(PTS-STARTPTS)/${k.toFixed(4)}[v${i}]`,
  )
  .join(";");
const joined = segs.map((_, i) => `[v${i}]`).join("");
const graph = `${trims};${joined}concat=n=${segs.length}:v=1:a=0,fps=30[out]`;
const input = ["-i", raw, "-an", "-filter_complex", graph, "-map", "[out]"];
ff(...input, "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", path.join(dir, "take.webm"));
ff(
  ...input,
  "-c:v",
  "libx264",
  "-crf",
  "22",
  "-preset",
  "slow",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  path.join(dir, "take.mp4"),
);
ff("-ss", marks.poster.toFixed(2), "-i", raw, "-frames:v", "1", "-q:v", "3", path.join(dir, "take.jpg"));
const speed = real / total;
// Chapter times in the sped-up take (seconds): what the page highlights while the clip plays.
const at = (name) => {
  const t = marks[name] - start;
  if (t <= waitFrom) return +t.toFixed(2);
  if (t <= waitTo) return +(waitFrom + (t - waitFrom) / WAIT_SPEED).toFixed(2);
  return +(waitFrom + (waitTo - waitFrom) / WAIT_SPEED + (t - waitTo)).toFixed(2);
};
const fps = frames.length / (frames[frames.length - 1].at - frames[0].at);
if (fps < MIN_FPS)
  throw new Error(`the take was filmed at ${fps.toFixed(1)} fps (< ${MIN_FPS}): run it again on a quieter machine`);
const evidence = {
  locale,
  fps: +fps.toFixed(1),
  base: BASE,
  recordedAt: new Date().toISOString(),
  runId,
  seconds: +total.toFixed(1),
  waitSpeed: +WAIT_SPEED.toFixed(2),
  chapters: { drop: at("drop"), check: at("check"), finding: at("finding"), search: at("search") },
};
writeFileSync(path.join(dir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`✓ ${locale}: ${evidence.seconds} s (wait x${evidence.waitSpeed}) · run ${runId} · ${dir}\n`);
