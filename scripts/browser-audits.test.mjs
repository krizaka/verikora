import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// Scripts that RECORD (demo takes, the motion is the point), not audit. Everything else that drives a browser measures,
// so it settles transitions first (verikora#354). A new browser script is an audit unless it is named here, with a reason.
const RECORDERS = new Set([
  "scripts/landing-journey.mjs",
  "scripts/landing-take.mjs",
  "scripts/record-krizaka-review.mjs",
  "scripts/showcase-web.mjs",
]);

const files = (dir) =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "node_modules"
        ? []
        : files(join(dir, e.name))
      : e.name.endsWith(".mjs") && !e.name.endsWith(".test.mjs")
        ? [join(dir, e.name)]
        : [],
  );
const browserScripts = [...files("scripts"), ...files("apps/web/scripts")].filter((f) =>
  /from "playwright(-core)?"|require\("playwright(-core)?"\)|createRequire[\s\S]*playwright/.test(
    readFileSync(join(ROOT, f), "utf8"),
  ),
);
const audits = browserScripts.filter((f) => !RECORDERS.has(f));

describe("the browser audits settle View Transitions before they measure (verikora#354)", () => {
  it("finds the audit scripts (the guard is not vacuous)", () => {
    assert.ok(audits.length >= 4, audits.join(", "));
    for (const f of RECORDERS)
      assert.ok(browserScripts.includes(f), `${f} is listed as a recorder but drives no browser`);
  });
  for (const f of audits) {
    it(`${f} uses the shared helper: reduced-motion context, settled loads and resizes`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.match(src, /@krizaka\/page-audit"/, "import from @krizaka/page-audit");
      assert.doesNotMatch(src, /\.newContext\(/, "open the context with auditContext(browser, options)");
      assert.doesNotMatch(src, /\.goto\(/, "load with loadSettled(page, url, options)");
      assert.doesNotMatch(src, /\.setViewportSize\(/, "resize with resizeSettled(page, size)");
      assert.doesNotMatch(src, /\.reload\(|\.goBack\(|\.goForward\(/, "navigate through the helper");
    });
  }
});
