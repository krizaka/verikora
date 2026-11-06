import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

// The accessibility guard (a bug means a missing guard): axe-core WCAG 2.1 AA in both page audits, held by a ratchet baseline.
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
// The public audit asks @krizaka/page-audit for the axe step (`a11y` option); the signed-in one runs axe itself.
const SUITES = [
  [
    "check-overflow.mjs",
    "a11y-baseline.json",
    [/from "@krizaka\/page-audit"/, /a11y: \{ app: "verikora", baseline: A11Y_BASELINE/],
  ],
  ["check-app-pages.mjs", "a11y-baseline.app.json", [/from "@krizaka\/a11y-audit"/, /auditA11y\(page\)/]],
];

describe("the a11y guard", () => {
  for (const [script, baseline, proofs] of SUITES) {
    it(`${script} runs axe through @krizaka/a11y-audit and ratchets against ${baseline}`, () => {
      const source = read(`scripts/${script}`);
      for (const proof of proofs) assert.match(source, proof);
      assert.match(source, new RegExp(`new URL\\("\\.\\./${baseline.replace(".", "\\.")}"`));
      assert.doesNotMatch(source, /from "axe-core"/, "apps never import axe-core");
    });

    it(`${baseline} holds counts, and no serious or critical rule (those are fixed, not recorded)`, () => {
      const { rules } = JSON.parse(read(baseline));
      for (const [rule, { impact, count }] of Object.entries(rules)) {
        assert.ok(Number.isInteger(count) && count > 0, `${rule}: a positive count`);
        assert.ok(["minor", "moderate"].includes(impact), `${rule} is ${impact}: fix it, do not record it`);
      }
    });
  }
});
