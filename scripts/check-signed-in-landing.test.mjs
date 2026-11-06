import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { pathOf, watchSignInLink } from "./check-signed-in-landing.mjs";

describe("the signed-in landing check (krizaka-ui#827)", () => {
  it("names the path a visitor landed on", () => {
    assert.equal(pathOf("https://www.verikora.com/fr/app?x=1"), "/fr/app");
  });

  it("is run by CI after the build, as the seeded persona", () => {
    const ci = readFileSync(new URL("./ci-after-build.sh", import.meta.url), "utf8");
    assert.match(
      ci,
      /E2E_EMAIL=\S+ E2E_PASSWORD=\S+ node scripts\/check-signed-in-landing\.mjs --base http:\/\/localhost:3000/,
    );
  });

  it("watches the header from the first moment of the document", () => {
    assert.match(String(watchSignInLink), /MutationObserver/);
    assert.match(String(watchSignInLink), /DOMContentLoaded/);
  });
});
