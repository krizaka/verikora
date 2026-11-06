import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { clipsOf, problemsOf } from "./check-download-page.mjs";

const li = (id, ratio) =>
  `<li class="x" data-video="${id}"><div style="aspect-ratio:${ratio}"><img src="https://cdn.test/${id}.jpg"></div></li>`;

describe("the post-deploy check of the download page (verikora#1968)", () => {
  it("reads the clips, their frame and their poster", () => {
    assert.deepEqual(clipsOf(li("mac-library-en", "1280 / 800")), [
      { id: "mac-library-en", ratio: 1.6, poster: "https://cdn.test/mac-library-en.jpg" },
    ]);
  });
  it("accepts a page of its own language, in the right frames", () => {
    assert.deepEqual(
      problemsOf(li("mac-library-en", "1280 / 800") + li("android-documents-en", "390 / 845"), "en"),
      [],
    );
  });
  it("refuses a French clip on /en, a Mac clip in a phone frame and an iOS clip", () => {
    assert.match(problemsOf(li("web-binder-fr", "1280 / 800"), "en")[0], /"fr" clip on the \/en page/);
    assert.match(problemsOf(li("mac-library-en", "390 / 845"), "en")[0], /instead of the desktop frame/);
    assert.match(problemsOf(li("ios-documents-en", "390 / 845"), "en")[0], /no frame/);
  });
});
