#!/usr/bin/env node
// The demo data set of a persona, on dev and local only.
//   DATABASE_URL=… [DATABASE_CA_CERT=…] [APP_DEMO_ACCOUNT_EMAIL=…] [APP_DEMO_ACCOUNT_PASSWORD=…] \
//     node scripts/demo-seed/cli.mjs --persona eric [--locale fr|en] [--reset]
//   The whole cast (`pnpm run dev:seed`, the dev deployment, CI, Maestro and the recorders all run this; krizaka/.github#356):
//     node scripts/demo-seed/cli.mjs --cast [--reset] [--check]   # --check fails when the fingerprint is not the recorded one
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { matchesRecorded } from "./cast.mjs";
import { seedPilotCode } from "./pilot-code.mjs";
import { assertNotProduction, PERSONAS, seedCast, seedPersona } from "./seed.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** The seed's clock: `--now <ISO>` or APP_VISUAL_NOW (the visual runs freeze it, scripts/ci-visual-start.sh), else the real instant. Dates are stamped from it. */
function seedClock() {
  const frozen = arg("now") ?? process.env.APP_VISUAL_NOW;
  if (frozen && Number.isNaN(Date.parse(frozen))) throw new Error("--now / APP_VISUAL_NOW must be an ISO instant");
  return frozen ? new Date(frozen) : new Date();
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"];

/** The whole cast on the database; with --check, compared to the recorded fingerprint (exact on a local database, « all there » on dev). */
async function runCast(client, url, { messagesByLocale, locale }) {
  const { hashPassword } = await import("../../apps/web/scripts/qa-accounts.mjs");
  const run = await seedCast((sql, values) => client.query(sql, values).then((r) => r.rows), {
    env: process.env,
    hashPassword,
    locale,
    messagesByLocale,
    reset: process.argv.includes("--reset"),
    now: seedClock(),
  });
  const piloted = await seedPilotCode((sql, values) => client.query(sql, values).then((r) => r.rows), seedClock());
  console.log(`demo:seed --cast: pilot code ${piloted ? "seeded" : "already there"} (1 file, a placeholder)`);
  console.log(`demo:seed --cast: ${run.member.name} (member), ${run.admin.name} (administrator), ${run.camille.name}`);
  console.log(`fingerprint: ${run.fingerprint}`);
  if (!process.argv.includes("--check")) return;
  const expected = JSON.parse(readFileSync(new URL("./fingerprint.json", import.meta.url), "utf8")).fingerprint;
  const exact = LOCAL_HOSTS.includes(url.hostname);
  if (!matchesRecorded(run.fingerprint, expected, exact))
    throw new Error(
      `the seeded data differs from the recorded fingerprint\n  expected ${expected}\n  got      ${run.fingerprint}`,
    );
  console.log(
    exact
      ? "fingerprint: matches the recorded one"
      : "fingerprint: everything recorded is there (this database is lived in: counts may exceed it)",
  );
}

async function main() {
  assertNotProduction(process.env);
  const cast = process.argv.includes("--cast");
  const persona = arg("persona") ?? "";
  if (!cast && !PERSONAS[persona])
    throw new Error(`--persona is required (known: ${Object.keys(PERSONAS).join(", ")})`);
  const locale = arg("locale") ?? "fr";
  if (!["fr", "en"].includes(locale)) throw new Error("--locale must be fr or en");
  const web = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const pg = web("pg");
  const url = new URL(process.env.DATABASE_URL ?? "");
  const tls = ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "");
  url.searchParams.delete("sslmode");
  const client = new pg.Client({
    connectionString: url.toString(),
    ...(tls ? { ssl: { ca: process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n"), rejectUnauthorized: true } } : {}),
  });
  const messagesByLocale = Object.fromEntries(
    ["fr", "en"].map((l) => [
      l,
      JSON.parse(readFileSync(new URL(`../../apps/web/messages/${l}.json`, import.meta.url), "utf8")),
    ]),
  );
  let passwordHash = null;
  if (!cast && process.env.APP_DEMO_ACCOUNT_PASSWORD) {
    if (process.env.APP_DEMO_ACCOUNT_PASSWORD.length < 12)
      throw new Error("APP_DEMO_ACCOUNT_PASSWORD must have at least 12 characters");
    passwordHash = await (
      await import("../../apps/web/scripts/qa-accounts.mjs")
    ).hashPassword(process.env.APP_DEMO_ACCOUNT_PASSWORD);
  }
  await client.connect();
  try {
    if (cast) return await runCast(client, url, { messagesByLocale, locale: arg("locale") });
    const result = await seedPersona((sql, values) => client.query(sql, values).then((r) => r.rows), {
      persona,
      email: process.env.APP_DEMO_ACCOUNT_EMAIL,
      locale,
      messagesByLocale,
      reset: process.argv.includes("--reset"),
      passwordHash,
      now: seedClock(),
    });
    console.log(`demo:seed (${persona}): ${result.email} — ${result.name ?? "(no name)"}`);
    for (const [name, n] of Object.entries(result.collections)) console.log(`  ${name}: ${n} documents`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`demo:seed: ${error.message}`);
  process.exit(1);
});
