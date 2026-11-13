import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { client, elementId, IDENTIFIER, libraryHash, scopeFile, scopeJson, until } from "./desktop-journey-lib.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (source) => source.replace(/^\s*#.*$/gm, "");

describe("the Mac journey's scope", () => {
  it("is the file the kit reads, in the app's data folder, with the roots it grants", () => {
    assert.equal(scopeFile("/Users/eric"), `/Users/eric/Library/Application Support/${IDENTIFIER}/scope.json`);
    assert.equal(IDENTIFIER, JSON.parse(read("../apps/desktop/src-tauri/tauri.conf.json")).identifier);
    assert.deepEqual(JSON.parse(scopeJson(["/Users/eric/Baux"])), { roots: ["/Users/eric/Baux"] });
  });
  it("routes a folder as the library's own link does", () => {
    assert.equal(libraryHash("/Users/eric/Mes baux"), "#/library/%2FUsers%2Feric%2FMes%20baux");
    assert.match(read("../apps/desktop/src/components/Library.tsx"), /href: `#\/library\/\$\{encodeURIComponent\(/);
  });
});

describe("the W3C client", () => {
  it("reads an element reference of either spelling", () => {
    assert.equal(elementId({ "element-6066-11e4-a52e-4f735466cecf": "a1" }), "a1");
    assert.equal(elementId({ ELEMENT: "b2" }), "b2");
  });
  it("opens a session, finds, clicks and quits through the server", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      const value = url.endsWith("/session")
        ? { sessionId: "s1" }
        : url.endsWith("/element")
          ? { "element-6066-11e4-a52e-4f735466cecf": "e1" }
          : null;
      return { ok: true, json: async () => ({ value }) };
    };
    const driver = await client("http://x", fetchImpl).start();
    await driver.click(await driver.find("button"));
    await driver.quit();
    assert.deepEqual(calls, [
      "POST /session",
      "POST /session/s1/element",
      "POST /session/s1/element/e1/click",
      "DELETE /session/s1",
    ]);
  });
  it("names the refused call", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ value: { message: "no such element" } }),
    });
    await assert.rejects(client("http://x", fetchImpl).start(), /POST \/session: HTTP 404 no such element/);
  });
});

describe("waiting", () => {
  it("returns the first truthy answer, and says what it waited for when time runs out", async () => {
    let n = 0;
    assert.equal(await until("three", () => ++n === 3 && "ok", { timeoutMs: 1000, sleep: async () => {} }), "ok");
    let t = 0;
    await assert.rejects(
      until("the lease", () => false, { timeoutMs: 10, sleep: async () => {}, now: () => (t += 6) }),
      /timed out waiting for the lease/,
    );
  });
});

describe("the driver never reaches a release", () => {
  it("is an optional cargo feature, registered in debug builds only", () => {
    const cargo = read("../apps/desktop/src-tauri/Cargo.toml");
    assert.match(cargo, /tauri-plugin-webdriver = \{ version = "0\.2\.3", optional = true \}/);
    assert.match(cargo, /webdriver = \["dep:tauri-plugin-webdriver"\]/);
    assert.match(
      read("../apps/desktop/src-tauri/src/lib.rs"),
      /#\[cfg\(all\(debug_assertions, feature = "webdriver"\)\)\]\s*let builder = builder\.plugin\(tauri_plugin_webdriver::init\(\)\)/,
    );
    const desktop = code(read("../.github/workflows/desktop.yml"));
    assert.doesNotMatch(desktop.split("desktop-release:")[1], /webdriver/);
    assert.match(
      code(read("../.github/actions/desktop-journey/action.yml")),
      /tauri build --debug --no-bundle --features webdriver/,
    );
  });
});

describe("the workflows", () => {
  it("run the journey on main and by hand (the dev environment admits protected branches only), with the persona passed by name", () => {
    const desktop = code(read("../.github/workflows/desktop.yml"));
    assert.match(
      desktop,
      /desktop-journey:\s+if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\)/,
    );
    assert.match(desktop, /workflow_dispatch:/);
    assert.match(
      desktop,
      /desktop-release:\s+if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/,
    );
    assert.match(desktop, /runs-on: macos-latest/);
    assert.match(desktop, /SMOKE_EMAIL: \$\{\{ secrets\.SMOKE_EMAIL \}\}/);
    assert.doesNotMatch(desktop, /secrets:\s*inherit/);
  });
  it("film it on main for the download page without ever blocking the other videos", () => {
    const videos = code(read("../.github/workflows/download-videos.yml"));
    assert.match(videos, /showcase-mac:[\s\S]*?continue-on-error: true/);
    assert.match(videos, /needs: \[showcase-web, mobile-showcase, showcase-mac\]/);
    assert.match(videos, /artifacts: \|\s+showcase-web\s+maestro-showcase\s+showcase-mac/);
    assert.match(
      read("../.github/workflows/download-videos.yml"),
      /join-cli\.mjs" showcase-mac "showcase-mac\/mac-library-\$locale\.mp4"/,
    );
    assert.doesNotMatch(code(read("../.github/actions/desktop-journey/action.yml")), /screencapture/);
  });
  it("records and joins with the shared film action of krizaka-rust, pinned by SHA; no copy of it lives here", () => {
    assert.match(
      read("../.github/workflows/download-videos.yml"),
      /uses: krizaka\/krizaka-rust\/\.github\/actions\/film@[0-9a-f]{40} # main\s+id: film/,
    );
    assert.match(read("../.github/workflows/download-videos.yml"), /film-dir: \$\{\{ steps\.film\.outputs\.dir \}\}/);
    assert.match(read("./desktop-journey.mjs"), /KRIZAKA_FILM_DIR/);
    for (const copy of ["desktop-film-lib.mjs", "desktop-film-join.mjs", "desktop-film.test.mjs"])
      assert.ok(!existsSync(new URL(copy, import.meta.url)), `${copy} is deleted: the shared tool is the one`);
  });
  it("the journey asserts what the issue asks: a folder, a lease checked, the result, the relaunch", () => {
    const journey = read("./desktop-journey.mjs");
    for (const needle of [
      "scopeJson([folder])",
      "check-document",
      "check-result",
      "the relaunch asked to sign in again",
      "the scope lost the folder",
    ])
      assert.ok(journey.includes(needle), needle);
  });
});

describe("the journey films the window, after the sign-in, without the engine's wait", () => {
  it("starts the frames on each screen worth reading and stops before the app quits", () => {
    const journey = read("./desktop-journey.mjs");
    const order = [
      "await signInIfAsked",
      "1-library",
      "filmWindow()",
      "check-document",
      "await film.stop(); // the engine",
      "3-result",
      "filmWindow()",
      "driver.quit()",
      "4-relaunch",
      "film.finish()",
    ];
    let at = -1;
    for (const needle of order) {
      const next = journey.indexOf(needle, at + 1);
      assert.ok(next > at, `${needle} comes after the previous step`);
      at = next;
    }
    assert.equal((journey.match(/film\.stop\(\)/g) ?? []).length >= 3, true);
  });
  it("accepts the --film flag the action passes (it was lost in a merge: run 41085183044, Unknown option '--film')", () => {
    assert.match(read("./desktop-journey.mjs"), /film: \{\s*type: "boolean"/);
    assert.match(read("../.github/actions/desktop-journey/action.yml"), /--film/);
  });
  it("the phone showcase finds the second collection by scrollUntilVisible alone (a bare scroll first pushed it past the screen)", () => {
    const flow = read("../apps/mobile/.maestro-showcase/android-documents-en.yaml");
    assert.ok(!/^- scroll$/m.test(flow));
    assert.match(flow, /scrollUntilVisible:\s+element: "Invoices 2026"/);
  });
  // verikora#1968: the phone film ends on a result and is named after its language; never an empty state in it.
  it("the phone showcase is English, ends on a collection's documents and never films the empty batches", () => {
    const flow = read("../apps/mobile/.maestro-showcase/android-documents-en.yaml");
    assert.match(flow, /startRecording: android-documents-en/);
    assert.doesNotMatch(flow, /tapOn: "(Lots|Batches)"/);
    assert.match(flow, /assertNotVisible/);
    assert.match(flow.slice(flow.indexOf("stopRecording") - 200), /extendedWaitUntil|assertNotVisible/);
  });
});
