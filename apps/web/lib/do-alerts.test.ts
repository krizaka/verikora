import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const spec = readFileSync(join(__dirname, "../../../deploy/digitalocean/dev.app.yaml"), "utf8");

describe("yomizaka-dev: DigitalOcean alerts the team (the same as krizaka-com, krizaka-internal#2631)", () => {
  it("a failed deployment or domain is an app alert", () => {
    expect(spec).toMatch(/^alerts:\n {2}- rule: DEPLOYMENT_FAILED\n {2}- rule: DOMAIN_FAILED\n/m);
  });

  it("the web service alerts on memory above 85 % and on more than two restarts over five minutes", () => {
    const web = spec.split(/^services:\n/m)[1]?.split(/^jobs:/m)[0] ?? "";
    expect(web).toMatch(/^ {4}alerts:\n {6}- rule: MEM_UTILIZATION\n {8}operator: GREATER_THAN\n {8}value: 85\n {8}window: FIVE_MINUTES\n/m);
    expect(web).toMatch(/- rule: RESTART_COUNT\n {8}operator: GREATER_THAN\n {8}value: 2\n {8}window: FIVE_MINUTES\n/);
  });
});
