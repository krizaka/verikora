import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import {
  assertFrames,
  assertLivelyStart,
  BLANK_BYTES,
  collapse,
  createFilm,
  HOLD_S,
  FILM_SIZE,
  FPS,
  frameList,
  framesInList,
  joinArgs,
  MIN_FRAMES,
  MIN_SCREENS,
} from "./desktop-film-lib.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const big = (n) => Buffer.alloc(BLANK_BYTES * 2, n).toString("base64");

describe("the frames of the film", () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => void (t += ms), advance: (ms) => void (t += ms) };
  };
  it("takes a screenshot of the window at a steady rate until stopped, and names the frames in order", async () => {
    const saved = [];
    const c = clock();
    let shots = 0;
    const film = createFilm({
      dir: "out",
      shoot: async () => {
        shots += 1;
        if (shots === 6) film.cancel();
        return Buffer.from(`png${shots}`).toString("base64");
      },
      now: c.now,
      sleep: c.sleep,
      save: (file, bytes) => saved.push([file, bytes?.toString?.()]),
      makeDir: () => undefined,
    });
    film.start();
    await film.done;
    assert.equal(film.count, 6);
    assert.deepEqual(saved[0], ["out/frames/frame-00001.png", "png1"]);
    assert.equal(film.frames[1].at - film.frames[0].at, 1000 / FPS);
  });
  it("skips a screenshot the window could not give instead of ending the film", async () => {
    const c = clock();
    let n = 0;
    const film = createFilm({
      dir: "out",
      shoot: async () => {
        n += 1;
        if (n === 2) throw new Error("mid-transition");
        if (n === 4) film.cancel();
        return "AA==";
      },
      now: c.now,
      sleep: c.sleep,
      save: () => undefined,
      makeDir: () => undefined,
    });
    film.start();
    await film.done;
    assert.equal(film.count, 3);
  });
  it("films nothing without a directory", async () => {
    const film = createFilm({ shoot: async () => assert.fail("no film, no screenshot") });
    film.start();
    await film.stop();
    assert.equal(film.finish(), 0);
  });
  it("fails loudly when it holds fewer frames than the minimum (no empty clip, no green job without a film)", () => {
    assert.throws(() => assertFrames(0), /filmed nothing/);
    assert.throws(() => assertFrames(MIN_FRAMES - 1), /at least 30/);
    assert.equal(assertFrames(MIN_FRAMES), MIN_FRAMES);
    const film = createFilm({ dir: "out", shoot: async () => "AA==", save: () => undefined, makeDir: () => undefined });
    assert.throws(() => film.finish(), /filmed nothing/);
  });
  it("writes the frame list only once the minimum is met", async () => {
    const written = [];
    const c = clock();
    let n = 0;
    const film = createFilm({
      dir: "out",
      shoot: async () => {
        n += 1;
        if (n === 3) film.cancel();
        return big(n);
      },
      now: c.now,
      sleep: c.sleep,
      save: (file) => written.push(file),
      makeDir: () => undefined,
    });
    film.start();
    await film.done;
    assert.equal(film.finish(3), 3);
    assert.ok(written.includes("out/film-frames.txt"));
  });
});

describe("the frame list", () => {
  it("shows each frame until the next, never longer than three intervals (a stopped take's gap is not played), the last once more", () => {
    const f = (file, at, hash, size = 9000) => ({ file, at, hash, size });
    const text = frameList([f("frames/a.png", 0, "a"), f("frames/b.png", 100, "b"), f("frames/c.png", 60_000, "c")]);
    assert.equal(
      text,
      "file 'frames/a.png'\nduration 0.100\nfile 'frames/b.png'\nduration 0.300\nfile 'frames/c.png'\nduration 0.100\nfile 'frames/c.png'\n",
    );
    assert.equal(framesInList(text), 3);
    assert.equal(framesInList(""), 0);
  });
});

describe("the start and the idle stretches of the film", () => {
  const f = (n, at, hash, size = 9000) => ({ file: `frames/${n}.png`, at, hash, size });
  it("cuts the blank window before the first screen that shows something", () => {
    const entries = collapse([f(1, 0, "x", 300), f(2, 100, "x", 300), f(3, 200, "a"), f(4, 300, "b")]);
    assert.deepEqual(
      entries.map((e) => e.file),
      ["frames/3.png", "frames/4.png"],
    );
  });
  it("shows an idle screen for HOLD_S at most, however long it waited, and keeps the pace of a moving one", () => {
    const idle = Array.from({ length: 50 }, (_, i) => f(i, i * 100, "same"));
    const [entry] = collapse([...idle, f(99, 5000, "next")]);
    assert.equal(entry.seconds, HOLD_S);
    const moving = collapse([f(1, 0, "a"), f(2, 100, "b"), f(3, 200, "c")]);
    assert.deepEqual(
      moving.map((e) => e.seconds.toFixed(1)),
      ["0.1", "0.1", "0.1"],
    );
  });
  it("refuses a film that opens blank, or on one picture only (idle), and accepts one that moves", () => {
    assert.throws(() => assertLivelyStart([f(1, 0, "a", 100), f(2, 100, "b")]), /blank/);
    assert.throws(() => assertLivelyStart([f(1, 0, "a"), f(2, 100, "a"), f(3, 200, "a")], 3), /same picture/);
    assert.throws(() => assertLivelyStart([f(1, 0, "a")]), /at least 2/);
    assert.doesNotThrow(() => assertLivelyStart([f(1, 0, "a"), f(2, 100, "b")]));
  });
  it("refuses a recorded film that never changed", async () => {
    const film = createFilm({
      dir: "out",
      shoot: async () => big(7),
      now: () => 0,
      sleep: async () => film.cancel(),
      save: () => undefined,
      makeDir: () => undefined,
    });
    film.start();
    await film.done;
    assert.throws(() => film.finish(1), /at least 2/);
  });
});

describe("the joined film", () => {
  it("is one silent mp4 of the frame list, letterboxed to one size", () => {
    const args = joinArgs("film-frames.txt", "film.mp4");
    assert.deepEqual(args.slice(0, 7), ["-y", "-f", "concat", "-safe", "0", "-i", "film-frames.txt"]);
    assert.match(
      args[args.indexOf("-vf") + 1],
      new RegExp(`scale=${FILM_SIZE.width}:${FILM_SIZE.height}:force_original_aspect_ratio=decrease`),
    );
    assert.ok(args.includes("-an") && args.at(-1) === "film.mp4");
  });
  it("is joined by a script that refuses a film with too few frames and never screen-records", () => {
    const join = read("./desktop-film-join.mjs");
    assert.match(join, /assertFrames\(framesInList\([^)]*\)[^)]*\), MIN_SCREENS\)/); // the list is collapsed: it counts screens, not raw frames
    assert.ok(MIN_SCREENS < MIN_FRAMES);
    for (const file of [
      "./desktop-film-lib.mjs",
      "./desktop-film-join.mjs",
      "./desktop-journey.mjs",
      "../.github/actions/desktop-journey/action.yml",
    ]) {
      assert.doesNotMatch(read(file).replace(/^\s*(\/\/|#).*$/gm, ""), /screencapture/, file);
    }
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
