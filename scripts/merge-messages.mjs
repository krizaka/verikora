#!/usr/bin/env node
/**
 * Regenerates apps/web/messages/{en,fr}.json from the per-domain catalogues.
 * The domain files are the source of truth; the flat files exist for backward
 * compatibility with test imports and are managed by this script.
 *
 * Usage:
 *   node scripts/merge-messages.mjs          # regenerate
 *   node scripts/merge-messages.mjs --check  # verify flat files are up to date (exits 1 if not)
 */
import fs from "node:fs";
import path from "node:path";

const CHECK = process.argv.includes("--check");
const DOMAINS = ["console", "documents", "legal", "marketing", "screening", "site"];
const LOCALES = ["en", "fr"];
const MESSAGES_DIR = "apps/web/messages";

let failed = false;

for (const locale of LOCALES) {
  let merged = {};
  for (const domain of DOMAINS) {
    const file = path.join(MESSAGES_DIR, domain, `${locale}.json`);
    const slice = JSON.parse(fs.readFileSync(file, "utf8"));
    merged = { ...merged, ...slice };
  }
  const expected = JSON.stringify(merged, null, 2) + "\n";
  const out = path.join(MESSAGES_DIR, `${locale}.json`);

  if (CHECK) {
    const actual = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (actual !== expected) {
      console.error(`✗ ${out} is out of sync with its domain catalogues. Run: node scripts/merge-messages.mjs`);
      failed = true;
    } else {
      console.log(`✓ ${out} is up to date`);
    }
  } else {
    fs.writeFileSync(out, expected);
    console.log(`wrote ${out} (${Object.keys(merged).length} top-level keys)`);
  }
}

if (failed) process.exit(1);
