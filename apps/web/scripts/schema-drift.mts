// The nightly job of the verikora-dev app (krizaka-internal#4881): reads the live schema of DATABASE_URL, compares it with
// lib/schema-expected.json, prints one line, exits 1 on drift or an unreachable database (DigitalOcean's JOB_INVOCATION_FAILED alert fires).
import { pool, query } from "../lib/db";
import expected from "../lib/schema-expected.json";
import { readSnapshot, type SchemaSnapshot } from "../lib/schema-check";
import { driftReport } from "../lib/schema-drift";

try {
  const report = driftReport(expected as SchemaSnapshot, await readSnapshot(query));
  await pool().end();
  console.log(report.line);
  process.exit(report.drifted ? 1 : 0);
} catch (error) {
  console.error(`drift check failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 600));
  process.exit(1);
}
