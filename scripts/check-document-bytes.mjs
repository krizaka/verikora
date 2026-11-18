#!/usr/bin/env node
// ADR-0012 guard on a real, seeded database: no document keeps bytes in PostgreSQL (`documents.content`); they live in a store.
// Usage: DATABASE_URL=… [DATABASE_CA_CERT=…] node scripts/check-document-bytes.mjs     (exit 1 on any row holding bytes)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { pgClientOptions } from "../apps/web/scripts/pg-client-options.mjs";

export const BYTES_QUERY =
  "SELECT id, octet_length(content) AS bytes FROM documents WHERE octet_length(content) > 0 ORDER BY created_at LIMIT 20";

/** The message of the check for the rows it found: null when the database keeps no bytes. */
export function problemOf(rows) {
  if (rows.length === 0) return null;
  const list = rows.map((r) => `${r.id} (${r.bytes} bytes)`).join(", ");
  return `ADR-0012: ${rows.length} document(s) keep bytes in PostgreSQL (documents.content), they belong in the store: ${list}`;
}

async function main() {
  const pg = createRequire(new URL("../apps/web/package.json", import.meta.url))("pg");
  const client = new pg.Client(pgClientOptions());
  await client.connect();
  try {
    const { rows } = await client.query(BYTES_QUERY);
    const problem = problemOf(rows);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
      return;
    }
    console.log("document bytes: none in PostgreSQL");
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
