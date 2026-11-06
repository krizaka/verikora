import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

// A bug means a missing guard: zizmor and Sonar (S7631) refused a workflow that ran with the org's secrets after a workflow_run.
const source = readFileSync(new URL("../.github/workflows/download-videos.yml", import.meta.url), "utf8");
const code = source.replace(/^\s*#.*$/gm, "");

describe("the download videos workflow", () => {
  it("runs on a schedule and on demand, never on a workflow_run", () => {
    assert.match(code, /schedule:/);
    assert.match(code, /workflow_dispatch:/);
    assert.doesNotMatch(code, /workflow_run/);
  });
  // Run 41135654722: the web job's trim died on a runner without ffprobe.
  it("installs ffmpeg before the web films are trimmed, and the trim fails loudly without it", () => {
    assert.ok(
      code.indexOf("apt-get install -y --no-install-recommends ffmpeg") < code.indexOf("film-trim.mjs showcase-web"),
    );
    assert.match(readFileSync(new URL("./film-trim.mjs", import.meta.url), "utf8"), /result\.error/);
  });
  it("names the secrets it passes, never inherits them", () => {
    assert.doesNotMatch(code, /secrets:\s*inherit/);
    assert.match(code, /MEDIA_STORAGE_API_KEY: \$\{\{ secrets\.MEDIA_STORAGE_API_KEY \}\}/);
  });
  it("never writes the demo password to GITHUB_ENV", () => {
    assert.doesNotMatch(code, /GITHUB_ENV/);
  });
  // verikora#575: the poster is the frame at 2 s; a film that opens on the sign-in made a sign-in the poster of the binder.
  it("films the binder already signed in and opens the report film on the report (the poster is the frame at 2 s)", () => {
    assert.match(code, /showcase-web\.mjs[^\n]*--sign-in off/);
    const script = readFileSync(new URL("./showcase-web.mjs", import.meta.url), "utf8");
    assert.match(script, /goto\(`\$\{base\}\/\$\{locale\}\$\{reportPath\}\/rapport`/);
  });
  it("waits for the navigation to the document before it reads the URL (a click is a client navigation)", () => {
    const script = readFileSync(new URL("./showcase-web.mjs", import.meta.url), "utf8");
    const click = script.indexOf("firstDocument(page).click()");
    const wait = script.indexOf("waitForURL(", click);
    const read = script.indexOf("new URL(page.url())", click);
    assert.ok(click > 0 && wait > click && read > wait, "waitForURL must sit between the click and the URL read");
  });
  it("opens the dossier with the demo leases, never the first row (the empty default collection) (verikora#1968)", () => {
    const script = readFileSync(new URL("./showcase-web.mjs", import.meta.url), "utf8");
    assert.match(script, /const DEMO_COLLECTION = \/Rosemont\//);
    // The home is the list of dossiers (#680): the film waits for the row of the demo leases and clicks that one.
    assert.match(
      script,
      /\[data-testid="home-dossiers"\] a\[href\*="\/app\/library\/"\]'\)\.filter\(\{ hasText: DEMO_COLLECTION \}\)/,
    );
    assert.match(script, /dossierRow\(page\)\.waitFor\(\{ timeout: 30_000 \}\)/);
    assert.doesNotMatch(script, /a\[title\]|binder-name|binderUrl/);
  });
  // verikora#1968: the films were French on /en, in a dev banner, with a runner path and an empty state.
  it("films the web in both languages, on data seeded in each", () => {
    assert.match(code, /for locale in fr en/);
    assert.match(code, /ci-mobile-backend\.sh reseed en/);
    assert.match(code, /showcase-web\.mjs[^\n]*--locale "\$locale"/);
  });
  it("films the phone and the Mac in showcase mode (no development notice) and names the Mac clip after its language", () => {
    assert.match(code, /EXPO_PUBLIC_APP_SHOWCASE=1/);
    assert.match(code, /DEMO_LOCALE=en bash scripts\/ci-mobile-backend\.sh/);
    assert.match(code, /film-locale\.txt/);
    assert.match(
      readFileSync(new URL("../.github/actions/desktop-journey/action.yml", import.meta.url), "utf8"),
      /VITE_APP_SHOWCASE/,
    );
  });
  it("shows no runner path: the Mac folder has a friendly name", () => {
    const journey = readFileSync(new URL("./desktop-journey.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(journey, /Verikora journey/);
    assert.match(journey, /join\(fixtureRoot\(\), "Leases"\)/);
  });
  it("trims the films with the markers guard (language, shape, empty/error/banner, ends on a result)", () => {
    assert.match(readFileSync(new URL("./film-trim.mjs", import.meta.url), "utf8"), /assertFilm\(/);
    assert.match(readFileSync(new URL("./showcase-web.mjs", import.meta.url), "utf8"), /markers\.json/);
  });
  it("checks the deployed download page in both languages", () => {
    const smoke = readFileSync(new URL("../.github/workflows/dev-smoke.yml", import.meta.url), "utf8");
    assert.match(smoke, /check-download-page\.mjs --base/);
  });
});
