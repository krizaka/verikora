import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { GAP_MAX_PX, PAGES, problemsOf, VIEWPORTS } from "./check-home-first-screen.mjs";

const measure = (patch = {}) => ({
  path: "/fr",
  width: 390,
  height: 844,
  theme: "dark",
  barBottom: 114,
  contentTop: 158,
  showcaseTop: 437,
  h1Bottom: 240,
  primaryBottom: 382,
  ...patch,
});

describe("the home's first screen, on the product-page template (krizaka-internal#4634)", () => {
  it("is quiet when the hero's text starts under the bar, within the template's own spacing, and the stage is on a phone's first screen", () => {
    assert.deepEqual(problemsOf(measure()), []);
    assert.deepEqual(problemsOf(measure({ contentTop: 114 + GAP_MAX_PX })), []);
    assert.deepEqual(problemsOf(measure({ width: 1440, height: 900, showcaseTop: 1200 })), []);
  });
  it("names a hero text hidden under the bar, a void above it, a stage below the first screen and a page without a bar", () => {
    assert.match(problemsOf(measure({ contentTop: 100 }))[0], /starts 14 px above the bar's bottom/);
    assert.match(problemsOf(measure({ contentTop: 114 + GAP_MAX_PX + 20 }))[0], /a void of 116 px under the bar/);
    assert.match(problemsOf(measure({ showcaseTop: 900 }))[0], /not on the first screen \(top 900 of 844\)/);
    assert.match(problemsOf(measure({ showcaseTop: null }))[0], /top none/);
    assert.match(problemsOf(measure({ barBottom: null }))[0], /no bar or no hero text/);
  });
  it("holds the five-second assertion on a phone: the H1 and the primary action within the first screen", () => {
    assert.deepEqual(problemsOf(measure({ primaryBottom: 844 })), []);
    assert.match(problemsOf(measure({ primaryBottom: 1000 }))[0], /the primary action is not within/);
    assert.match(problemsOf(measure({ h1Bottom: null }))[0], /the H1 is not within .*bottom none/);
    assert.deepEqual(problemsOf(measure({ width: 1440, height: 900, showcaseTop: 100, primaryBottom: 5000 })), []);
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
