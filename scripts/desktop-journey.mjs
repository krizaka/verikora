#!/usr/bin/env node
// The Mac app's journey (verikora#636, ADR-017): the persona opens Verikora for the Mac on a folder of leases, one lease is read and
// checked by the real engine, the result is shown, and a relaunch keeps the folder and the session.
//
//   node scripts/desktop-journey.mjs --app apps/desktop/src-tauri/target/debug/verikora-desktop --out desktop-journey
//   (the persona of the dev environment is read from the SMOKE_EMAIL / SMOKE_PASSWORD variables, as the dev smoke does)
//
// The native folder dialog cannot be driven by a WebDriver: the folder is granted the way the dialog would, by writing the
// kit's `scope.json` before the launch. The scope is the kit's own (`ScopeStore::load` re-checks every root), so a folder the
// kit refuses is refused here too. The build is `tauri build --debug --no-bundle -- --features webdriver`: the driver is never
// in a release.
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { generateDocument } from "./demo-documents/index.mjs";
import { createFilm } from "./desktop-film-lib.mjs";
import { client, libraryHash, scopeFile, scopeJson, until } from "./desktop-journey-lib.mjs";

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    out: { type: "string", default: "desktop-journey" },
    film: { type: "boolean", default: false },
  },
});
if (!values.app) throw new Error("--app <path to the debug binary> is required");
const persona = { email: process.env.SMOKE_EMAIL, secret: process.env.SMOKE_PASSWORD };
if (!persona.email || !persona.secret)
  throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required (the persona of the dev environment)");

const home = homedir();
const out = resolve(values.out);
// @fixed: a launch that does not answer in a minute is a build that crashed at start
const LAUNCH_MS = 60_000;
// @fixed: the real engine reads the lease and the rules run: a few minutes, as the dev smoke allows
const CHECK_MS = 240_000;
// @fixed: a screen of the app that is not there in 30 s is not coming
const SCREEN_MS = 30_000;

/**
 * Where the fixture folder lives: the CI runner's temp (`RUNNER_TEMP`), else the Krizaka workspace's `tmp/` (`KRIZAKA_WORKSPACE`,
 * default `~/krizaka-workspace`). Never a person's own folders: a journey run on the founder's Mac leaves nothing there (the kit
 * refuses the home itself, `/`, `/tmp`, `/var` anyway). Guarded by scripts/no-home-writes.test.mjs.
 */
const fixtureRoot = () =>
  process.env.RUNNER_TEMP ?? join(process.env.KRIZAKA_WORKSPACE ?? join(home, "krizaka-workspace"), "tmp");

/** The fixture: a folder of the journey's own holding one demo lease. */
async function fixtureFolder() {
  // A friendly name (the library shows it), not a work folder path (verikora#1968).
  const folder = join(fixtureRoot(), "Leases");
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const lease = await generateDocument("bail-rosemont-5-clause-illegale");
  await writeFile(join(folder, lease.filename), lease.bytes);
  return realpath(folder);
}

function launch() {
  const child = spawn(values.app, [], { stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", (error) => {
    console.error(`desktop journey: cannot start the app: ${error.message}`);
    process.exit(1);
  });
  return child;
}

const connect = (step) =>
  until(`the app's WebDriver (${step})`, () => client().start(), { timeoutMs: LAUNCH_MS, everyMs: 1000 });

async function shot(driver, name) {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `${name}.png`), Buffer.from(await driver.screenshot(), "base64"));
}

const FOLDER_LINK = "aside a[href^='#/library/']";

/** Signs in when the app asks for it; says whether it did. */
async function signInIfAsked(driver) {
  await until(
    "the sign-in or the library",
    async () => (await driver.exists("input[name=email]")) || (await driver.exists(FOLDER_LINK)),
    { timeoutMs: SCREEN_MS },
  );
  if (!(await driver.exists("input[name=email]"))) return false;
  await driver.type(await driver.find("input[name=email]"), persona.email);
  await driver.type(await driver.find("input[name=password]"), persona.secret);
  await driver.click(await driver.find("button[type=submit]"));
  return true;
}

// The film (verikora#636): the app's window only, from the signed-in library, as WebDriver screenshots, skipping the engine's wait.
const film = createFilm({ dir: values.film ? out : undefined, shoot: () => driver.screenshot() });
// @fixed: long enough to read a screen of the app, short enough for a clip under 30 s in all
const READ_MS = 3000;
const hold = (ms = READ_MS) => new Promise((resolveHold) => setTimeout(resolveHold, ms));
const filmWindow = () => film.start();

// verikora#1968: a filmed screen is never an error, an empty state or the development notice. Checked by the app's own markers at each
// screen of the film; the journey fails (and so no clip is published) rather than film one.
const UNFIT = { error: "[data-testid$='-error']", empty: "[data-testid$='-empty']", notice: "[data-stage]" };
async function assertFit(drv, screen) {
  if (!values.film) return;
  for (const [what, css] of Object.entries(UNFIT))
    if (await drv.exists(css)) throw new Error(`the film of "${screen}" would show an ${what} (${css}): not published`);
}

const waitFor = (driver, what, css, timeoutMs = SCREEN_MS) => until(what, () => driver.exists(css), { timeoutMs });

let app;
let driver;
try {
  const folder = await fixtureFolder();
  const scope = scopeFile(home);
  await rm(dirname(scope), { recursive: true, force: true });
  await mkdir(dirname(scope), { recursive: true });
  await writeFile(scope, scopeJson([folder]));

  // 1. Open the app: the persona signs in, the folder granted before the launch is listed.
  app = launch();
  driver = await connect("first launch");
  await signInIfAsked(driver);
  await waitFor(driver, "the granted folder in the library", FOLDER_LINK);
  await shot(driver, "1-library");
  await mkdir(out, { recursive: true });
  filmWindow();
  await assertFit(driver, "library");
  await hold();

  // 2. Open the folder: its lease is listed; check it.
  await driver.run("window.location.hash = arguments[0]", libraryHash(folder));
  await waitFor(driver, "the lease in the folder", "[data-testid=check-document]");
  await shot(driver, "2-folder");
  await assertFit(driver, "folder");
  await hold();
  await driver.click(await driver.find("[data-testid=check-document]"));
  await hold(2000);
  await film.stop(); // the engine's wait is not in the film

  // 3. The lease is read and checked by the engine, the result is shown.
  await waitFor(driver, "the check screen", "[data-testid=check-view]");
  await waitFor(driver, "the result of the check", "[data-testid=check-result]", CHECK_MS);
  const hash = await driver.hash();
  if (!hash.startsWith("#/check/")) throw new Error(`the result is shown on ${hash}, not on a check`);
  await shot(driver, "3-result");
  // The language the film is in (the page of the same language shows it, verikora#1968): the workflow names the clip after it.
  if (values.film)
    await writeFile(join(out, "film-locale.txt"), String(await driver.run("return document.documentElement.lang")));
  filmWindow();
  await assertFit(driver, "result"); // the film ends on the result
  await hold(4000);
  await film.stop(); // the app is about to quit: nothing of the desktop is filmed

  // 4. Relaunch: the folder is still granted and the session is still there.
  await driver.quit().catch(() => undefined);
  app.kill();
  await new Promise((resolveExit) => app.once("exit", resolveExit));
  app = launch();
  driver = await connect("relaunch");
  if (await signInIfAsked(driver)) throw new Error("the relaunch asked to sign in again: the session was not kept");
  await waitFor(driver, "the folder after the relaunch", FOLDER_LINK);
  const kept = JSON.parse(await readFile(scope, "utf8")).roots;
  if (!kept.includes(folder)) throw new Error(`the scope lost the folder: ${JSON.stringify(kept)}`);
  await shot(driver, "4-relaunch");
  // The relaunch is proved, not filmed: the film ends on the check's result, never on the library it is reached from (verikora#1968).
  film.finish(); // too few frames: the journey fails loudly, no empty clip
  console.log("desktop journey: ok");
} catch (error) {
  await film.stop().catch(() => undefined);
  if (driver) await shot(driver, "failure").catch(() => undefined);
  console.error(`desktop journey: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (driver) await driver.quit().catch(() => undefined);
  app?.kill();
}
