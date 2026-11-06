import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { GAP_PX, PAGES, problemsOf, VIEWPORTS } from "./check-home-first-screen.mjs";

const measure = (patch = {}) => ({
  path: "/fr",
  width: 390,
  height: 844,
  theme: "dark",
  barBottom: 68,
  contentTop: 68 + GAP_PX,
  showcaseTop: 620,
  visualClipped: false,
  ...patch,
});

describe("the home's first screen (the UX review's Y9)", () => {
  it("is quiet when the page starts 24 px under the bar and the product's visual is on a phone's first screen", () => {
    assert.deepEqual(problemsOf(measure()), []);
    assert.deepEqual(problemsOf(measure({ contentTop: 68 + GAP_PX + 5 })), []);
    assert.deepEqual(problemsOf(measure({ width: 1440, height: 900, showcaseTop: 1200 })), []);
  });
  it("counts the 24 px from the bottom of the bar, which stands below the notice when it is shown, and still refuses a void", () => {
    assert.deepEqual(problemsOf(measure({ barBottom: 68 + 37, contentTop: 68 + 37 + GAP_PX })), []);
    assert.match(
      problemsOf(measure({ barBottom: 68 + 37, contentTop: 68 + 37 + 80 }))[0],
      /starts 80 px under the bar, not 24/,
    );
    // a page that starts under the notice only (the bar not cleared) is a gap of -13: refused, with the overlap
    assert.match(problemsOf(measure({ barBottom: 68, contentTop: 68 - 13 }))[0], /starts -13 px under the bar, not 24/);
  });
  it("names a void above the hero, a visual below the first screen, and a page without a bar", () => {
    assert.match(problemsOf(measure({ contentTop: 68 + 80 }))[0], /starts 80 px under the bar, not 24/);
    assert.match(problemsOf(measure({ showcaseTop: 900 }))[0], /not on the first screen \(top 900 of 844\)/);
    assert.match(problemsOf(measure({ showcaseTop: null }))[0], /top none/);
    assert.match(problemsOf(measure({ barBottom: null }))[0], /no bar or no hero frame/);
    assert.match(problemsOf(measure({ visualClipped: true }))[0], /clips its text/);
  });
  it("names a fixed bar that covers the notice (verikora#449)", () => {
    assert.match(
      problemsOf(measure({ chromeOverlaps: ["div.kz-environment-notice / div.fixed.top-3"] }))[0],
      /top chrome chromeOverlaps/,
    );
    assert.deepEqual(problemsOf(measure({ chromeOverlaps: [] })), []);
  });
  it("walks both languages, a phone and a desktop", () => {
    assert.deepEqual(PAGES, ["/fr", "/en"]);
    assert.deepEqual(
      VIEWPORTS.map((v) => v.width),
      [390, 1280, 1600],
    );
  });
});
