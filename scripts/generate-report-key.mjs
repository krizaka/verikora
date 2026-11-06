#!/usr/bin/env node
// Generates the Ed25519 key that signs Verikora's audit reports. Prints NOTHING of it: it writes
// APP_REPORT_SIGNING_KEY into the env file you name (mode 0600), to be stored as a DO SECRET.
//
//   node scripts/generate-report-key.mjs <env-file>      (refuses to replace a key already there: rotate on purpose)
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import crypto from "node:crypto";
import { basename, resolve } from "node:path";

/** The only files this script writes are dotenv files (named like `.env.local` or `prod.env`): a mistyped path never overwrites anything else. */
export const isDotenvFile = (path) => /^(\.env(\.[\w-]+)?|[\w-]+\.env)$/.test(basename(path));

const arg = process.argv[2];
const file = arg && isDotenvFile(arg) ? resolve(arg) : undefined;
if (!file) {
  console.error(
    "usage: node scripts/generate-report-key.mjs <env-file>   (a file named .env, .env.<name> or <name>.env)",
  );
  process.exit(2);
}
const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
if (lines.some((l) => /^\s*APP_REPORT_SIGNING_KEY\s*=\s*\S/.test(l))) {
  console.error(
    "APP_REPORT_SIGNING_KEY is already set in that file: not replaced (a new key invalidates nothing already signed, but the old public key must stay published)",
  );
  process.exit(1);
}
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const value = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const kept = lines.filter((l) => !/^\s*APP_REPORT_SIGNING_KEY\s*=/.test(l) && l !== "");
writeFileSync(file, [...kept, `APP_REPORT_SIGNING_KEY=${value}`, ""].join("\n"));
chmodSync(file, 0o600);
const id = crypto
  .createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex")
  .slice(0, 16);
console.log(`APP_REPORT_SIGNING_KEY written to ${file} (key id ed25519:${id}); value not shown`);
