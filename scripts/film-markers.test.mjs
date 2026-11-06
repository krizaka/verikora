import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { assertFilm, framesOf, parseFilmName, probe } from "./film-markers-lib.mjs";

const ok = { lang: "en", error: false, empty: false, devBanner: false, result: true };
const film = (over = {}) => ({
  name: "web-binder-en.webm",
  markers: { frames: [ok, ok] },
  size: { width: 1280, height: 800 },
  ...over,
});
const refuses = (over, message) => assert.throws(() => assertFilm(film(over)), message);

// verikora#1968: bug -> missing guard. Each case is a defect the founder saw on the live download page.
describe("the guard of a film before it is published (verikora#1968)", () => {
  it("accepts a film in its language, its frame's shape, clean, ending on its result", () => {
    assert.doesNotThrow(() => assertFilm(film()));
  });
  it("reads the language from the name and refuses a name without one", () => {
    assert.deepEqual(parseFilmName("mac-library-fr.mp4"), { platform: "mac", flow: "library", locale: "fr" });
    assert.equal(parseFilmName("web-binder.webm"), null);
    refuses({ name: "web-binder.webm" }, /must be <platform>-<flow>-<en\|fr>/);
  });
  it("refuses French data on the English film", () => {
    refuses({ markers: { frames: [ok, { ...ok, lang: "fr" }] } }, /in "fr", the film is for "en"/);
  });
  it("refuses the Mac clip in a phone shape and a phone clip in a desktop shape", () => {
    refuses({ name: "mac-library-en.mp4", size: { width: 390, height: 845 } }, /not the shape of the desktop frame/);
    refuses(
      { name: "android-documents-en.mp4", size: { width: 1280, height: 800 } },
      /not the shape of the phone frame/,
    );
    assertFilm(film({ name: "mac-library-en.mp4", size: { width: 720, height: 450 } }));
    assertFilm(film({ name: "android-documents-en.mp4", size: { width: 1080, height: 2400 } }));
  });
  it("refuses a platform without a frame (no iOS film until there is an iOS frame and flow)", () => {
    refuses({ name: "ios-documents-en.mp4" }, /has no frame/);
    assert.equal(framesOf().platforms.ios, undefined);
  });
  it("refuses an error state, an empty state and the development banner", () => {
    refuses({ markers: { frames: [ok, { ...ok, error: true }, ok] } }, /error state/);
    refuses({ markers: { frames: [{ ...ok, empty: true }, ok] } }, /empty state/);
    refuses({ markers: { frames: [{ ...ok, devBanner: true }, ok] } }, /development banner/);
  });
  it("refuses a film that does not end on its result, and a film without markers", () => {
    refuses({ markers: { frames: [ok, { ...ok, result: false }] } }, /does not end on its result/);
    refuses({ markers: undefined }, /no markers/);
    refuses({ markers: { frames: [] } }, /no markers/);
  });
  it("probes error, empty and banner markers by the app's test ids and the stage notice", () => {
    assert.match(probe.toString(), /data-testid\$="-error"/);
    assert.match(probe.toString(), /data-testid\$="-empty"/);
    assert.match(probe.toString(), /data-top-chrome/);
  });
});
