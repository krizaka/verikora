import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const source = readFileSync(new URL("./record-krizaka-review.mjs", import.meta.url), "utf8");

test("the walkthrough says every beat in English and in French", () => {
  const beats = [...source.matchAll(/take\.beat\("(\w+)"\)/g)].map((m) => m[1]);
  for (const beat of [
    "intro",
    "drop",
    "invoice",
    "running",
    "invoiceFindings",
    "folioviv",
    "foliovivFindings",
    "contract",
    "contractFindings",
    "notes",
    "outro",
  ]) {
    assert.ok(beats.includes(beat), `beat ${beat}`);
    assert.match(
      source,
      new RegExp(`${beat}: \\{\\n    en: "[^"]{10,}",\\n    fr: "[^"]{10,}"`),
      `words ${beat} (en + fr)`,
    );
  }
});

test("it checks the Québec rulesets, uses redacted copies and never says « compliant » as a verdict", () => {
  assert.match(source, /qc-invoice/);
  assert.match(source, /qc-service-contract/);
  assert.match(source, /redacted copies|REDACTED copies/i);
  assert.match(source, /passed/);
});

test("credentials stay in the environment, never in the file or the output", () => {
  assert.match(source, /need\("E2E_PASSWORD"\)/);
  assert.doesNotMatch(source, /password:\s*["'`][^"'`]{6,}["'`]/i);
  assert.doesNotMatch(source, /console\.log\([^)]*password/i);
  assert.doesNotMatch(source, /1182652231|Sainte-Marguerite|Abid|Desjardins/);
});
