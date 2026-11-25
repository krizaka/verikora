import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const spec = readFileSync(join(__dirname, "../../../deploy/digitalocean/dev.app.yaml"), "utf8");

/** The alert rules DigitalOcean accepts at the app scope: `JOB_INVOCATION_FAILED` "is not supported at the component scope" (krizaka-internal#4233). */
const APP_ALERT_RULES = new Set(["DEPLOYMENT_FAILED", "DOMAIN_FAILED", "JOB_INVOCATION_FAILED"]);

/** The lines of a top-level key's block (up to the next top-level key). */
function block(key: string): string[] {
  const rest = spec.split("\n");
  const start = rest.findIndex((l) => l === `${key}:`);
  if (start < 0) {
    return [];
  }
  const after = rest.slice(start + 1);
  const end = after.findIndex((l) => /^\S/.test(l) && !l.startsWith("#"));
  return end < 0 ? after : after.slice(0, end);
}

describe("the dev app spec: the nightly schema check (krizaka-internal#4881)", () => {
  it("declares no alert on a job: the job rules are refused at the component scope", () => {
    expect(block("jobs").filter((l) => /^\s+alerts:/.test(l))).toEqual([]);
  });

  it("uses only accepted rules at the app scope, and alerts on a failed job", () => {
    const rules = block("alerts")
      .map((l) => /^\s*- rule:\s*(\S+)\s*$/.exec(l)?.[1])
      .filter((r): r is string => Boolean(r));
    for (const rule of rules) {
      expect(APP_ALERT_RULES.has(rule), `${rule} is not accepted by DigitalOcean at the app scope`).toBe(true);
    }
    expect(rules).toContain("JOB_INVOCATION_FAILED");
  });

  it("runs a scheduled schema-drift job with the database secrets only", () => {
    const jobs = block("jobs").join("\n");
    const drift = jobs.slice(jobs.indexOf("- name: schema-drift"));
    expect(drift).toContain("kind: SCHEDULED");
    expect(drift).toContain("dockerfile_path: deploy/schema-drift/Dockerfile");
    expect(drift).toContain("key: DATABASE_URL");
    expect(drift).toContain("key: DATABASE_CA_CERT");
  });
});
