#!/usr/bin/env node
// Re-downloads the brand icons of verikora from the Krizaka CDN, byte for byte (never redrawn).
// They are generated from @krizaka/ui by krizaka-ui `tools/export-brand.mjs`; `brand/manifest.json` lists each file's SHA-256.
//   node scripts/sync-brand-icons.mjs          # download and write
//   node scripts/sync-brand-icons.mjs --check  # only compare with the CDN manifest (exit 1 on drift)
// Dependency-free. Two guards: the brand-icons test (offline: committed icon sha256 = scripts/brand-icons.lock.json) and CI's
// `--check` after the build (online: the lock and the icons = the CDN manifest). The test needs no network, so a sandbox
// without access to the CDN (a coding agent's) can still run the whole check.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CDN = "https://krizaka-assets.b-cdn.net";
// The id the brand export of krizaka-ui still files this product under, until the major release of `@krizaka/org` (krizaka-internal#2659).
export const BRAND = "yomizaka";
/** CDN file (under brand/<brand>/) -> committed path, relative to the repository root. */
export const ICONS = {
  "favicon.svg": "apps/web/app/icon.svg",
  "favicon-32.png": "apps/web/app/icon1.png",
  "apple-touch-icon.png": "apps/web/app/apple-icon.png",
  "icon-192.png": "apps/web/app/icon2.png",
  "icon-512.png": "apps/web/app/icon3.png",
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The CDN manifest's entries for this brand, as of the last sync: what the offline test checks the icons against. */
export const LOCK = path.join(ROOT, "scripts/brand-icons.lock.json");

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export async function fetchRetry(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = new Error(`${url}: HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw last;
}

/** { "brand/<brand>/<file>": sha256 } from the CDN manifest. */
export async function cdnHashes() {
  const manifest = JSON.parse((await fetchRetry(`${CDN}/brand/manifest.json`)).toString("utf8"));
  return Object.fromEntries(manifest.files.map((f) => [f.path, f.sha256]));
}

export async function main(check = process.argv.includes("--check")) {
  const hashes = await cdnHashes();
  const locked = JSON.parse(await readFile(LOCK, "utf8").catch(() => "{}"));
  let drift = 0;
  for (const [file, dest] of Object.entries(ICONS)) {
    const key = `brand/${BRAND}/${file}`;
    if (!hashes[key]) throw new Error(`${key} is not in the CDN manifest`);
    const target = path.join(ROOT, dest);
    if (check) {
      const have = await readFile(target).then(sha256, () => "missing");
      if (have !== hashes[key]) {
        drift++;
        console.error(`drift: ${dest}`);
      }
      if (locked[key] !== hashes[key]) {
        drift++;
        console.error(`drift: ${key} in scripts/brand-icons.lock.json`);
      }
      continue;
    }
    const buf = await fetchRetry(`${CDN}/${key}`);
    if (sha256(buf) !== hashes[key]) throw new Error(`${key}: downloaded bytes do not match the manifest`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buf);
    console.log(`${dest}  <-  ${key}`);
  }
  if (!check) {
    const lock = Object.fromEntries(
      Object.keys(ICONS).map((file) => [`brand/${BRAND}/${file}`, hashes[`brand/${BRAND}/${file}`]]),
    );
    await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  }
  if (drift) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
