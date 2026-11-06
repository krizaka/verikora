import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type ComplianceReport, complianceReport } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { generateDocument, PERSONA_ERIC } from "../../../../scripts/demo-documents/index.mjs";
import { seededReport } from "../../../../scripts/demo-seed/seed.mjs";
import { withTenantShield } from "./tenant-shield-report";

/**
 * The demo leases' tenant-shield findings (`scripts/demo-seed/tenant-shield.json`) are what the real adapter writes on the leases' figures.
 * A drift fails here; regenerate with `UPDATE_TENANT_SHIELD=1 pnpm vitest run lib/rules/tenant-shield-fixture.test.ts` and read the diff.
 */
const FILE = join(__dirname, "../../../../scripts/demo-seed/tenant-shield.json");
// the TAL's 2026 rate, as the migration seeds it (3,1 %)
const rate: Record<string, string | number> = {
  "tal.rate.year": 2026,
  "tal.rate.basisPoints": 310,
  "tal.rate.sourceUrl":
    "https://www.quebec.ca/nouvelles/actualites/details/le-calcul-de-lajustement-des-loyers-en-2026-68053",
  "tal.rate.enteredOn": "2026-10-29",
};
const reader = { get: async (key: string) => rate[key] };
type Shown = { ruleId: string; verdict: string };

async function expected() {
  const out: Record<string, Shown[]> = {};
  for (const id of PERSONA_ERIC.checked as string[]) {
    const doc = await generateDocument(id);
    if (doc.family !== "lease") continue;
    const base = seededReport({ ...doc, id: "none" }) as ComplianceReport;
    const shielded = await withTenantShield({ ...base, rulesetId: "qc-residential-lease" }, reader);
    out[id] = shielded.findings.slice(base.findings.length) as unknown as Shown[];
  }
  return out;
}

describe("the demo cast's tenant-shield findings", () => {
  it("are the ones the rules give on the demo leases", async () => {
    const now = await expected();
    if (process.env.UPDATE_TENANT_SHIELD) writeFileSync(FILE, `${JSON.stringify(now, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(now);
  });

  it("show Section G on the leases and the payment clauses on the lease with illegal clauses", async () => {
    const all = await expected();
    const pairs = (id: string) => (all[id] ?? []).map((f) => [f.ruleId, f.verdict]);
    expect(pairs("bail-rosemont-4-sans-avis-tal")).toContainEqual(["TS-G-001", "FAIL"]);
    expect(pairs("bail-rosemont-5-clause-illegale")).toContainEqual(["TS-P-001", "FAIL"]);
    expect(pairs("bail-rosemont-1-conforme")).toContainEqual(["TS-G-001", "PASS"]);
  });

  it("a seeded lease report is a valid report that keeps its facts", async () => {
    const doc = await generateDocument("bail-rosemont-5-clause-illegale");
    const report = complianceReport.parse(seededReport(doc));
    expect(Object.keys(report.facts ?? {})).toEqual(
      expect.arrayContaining(["rentCents", "depositCents", "postdatedCheques"]),
    );
  });
});
