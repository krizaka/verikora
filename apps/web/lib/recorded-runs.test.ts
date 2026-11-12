import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PERSPECTIVES } from "@verikora/core";
import { describe, expect, it } from "vitest";

import landlordFile from "@/content/recorded-runs/landlord.json";
import tenantFile from "@/content/recorded-runs/tenant.json";

import { readRecording, recordedRun, RecordedRunError, recordedRuns } from "./recorded-runs";

const ROOT = join(__dirname, "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("The recorded runs: one per side of the lease, or the home does not build", () => {
  it("has one recorded run for each side, a real Sovkora run with its id and Studio version", () => {
    expect(recordedRuns().map((r) => r.side)).toEqual([...PERSPECTIVES]);
    for (const r of recordedRuns()) {
      expect(r.runId).toMatch(UUID);
      expect(r.studioVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.report.jurisdiction).toBe("QC");
      expect(r.report.findings.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(r.recordedAt))).toBe(false);
    }
    expect(recordedRun("tenant").runId).not.toBe(recordedRun("landlord").runId);
  });

  it("keeps what Sovkora returned, verbatim: the file holds the run as returned and the page reads its findings", () => {
    for (const [side, file] of [
      ["tenant", tenantFile],
      ["landlord", landlordFile],
    ] as const) {
      expect(file.run.status).toBe("SUCCEEDED");
      expect(file.run.id).toBe(recordedRun(side).runId);
      const report = JSON.parse(file.run.outputs.find((o) => o.key === "report")!.value) as { findings: unknown[] };
      expect(recordedRun(side).report.findings).toHaveLength(report.findings.length);
    }
  });

  it("holds no secret", () => {
    for (const side of PERSPECTIVES)
      expect(readFileSync(join(ROOT, `content/recorded-runs/${side}.json`), "utf8")).not.toMatch(
        /oz_[A-Za-z0-9]|Bearer |password/i,
      );
  });

  it("fails — a build error, not a blank page — when a recording is missing, unfinished or has no report", () => {
    expect(() => readRecording("tenant", null)).toThrow(RecordedRunError);
    expect(() => readRecording("tenant", { ...tenantFile, side: "landlord" })).toThrow(RecordedRunError);
    expect(() => readRecording("tenant", { ...tenantFile, run: { ...tenantFile.run, status: "FAILED" } })).toThrow(
      /did not return a finished run/,
    );
    expect(() => readRecording("tenant", { ...tenantFile, run: { ...tenantFile.run, outputs: [] } })).toThrow(
      /holds no compliance report/,
    );
  });

  it("the home imports the recording, so a home without one cannot be built", () => {
    const page = readFileSync(join(ROOT, "app/[locale]/page.tsx"), "utf8");
    expect(page).toContain('from "@/lib/recorded-runs"');
    expect(page).toContain('recordedRun("tenant")');
    expect(page).not.toContain("getShowcaseView");
  });

  it("the two sides are two different leases with two different results", () => {
    const [t, l] = [recordedRun("tenant"), recordedRun("landlord")];
    expect(t.document.sha256).not.toBe(l.document.sha256);
    expect(t.report.findings.filter((f) => f.verdict === "FAIL").length).toBeGreaterThan(0);
    expect(l.report.findings.filter((f) => f.verdict === "FAIL").length).toBeGreaterThan(0);
  });

  it("was recorded with the current ruleset (revision 5, sixteen rules): the amountless deposit of the landlord's template is caught, the waiver rule ran", () => {
    for (const side of PERSPECTIVES) {
      const r = recordedRun(side);
      expect(r.report.rulesetRevision).toBe(5);
      expect(r.report.findings.map((f) => f.ruleId)).toContain("QC-LEASE-009");
      expect(r.report.summary?.rulesEvaluated).toBe(16);
    }
    expect(recordedRun("landlord").document.text).toMatch(/dépôt de garantie équivalant à un mois de loyer/);
    expect(recordedRun("landlord").report.findings.find((f) => f.ruleId === "QC-LEASE-004")?.verdict).toBe("FAIL");
  });
});
