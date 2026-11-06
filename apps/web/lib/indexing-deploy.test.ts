import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const spec = readFileSync(join(__dirname, "../../../deploy/digitalocean/dev.app.yaml"), "utf8");

describe("www.verikora.com is indexed (krizaka-com AGENTS §2.4); dev. and admin. are not", () => {
  it("the dev app spec leaves APP_SEARCH_INDEXING on, so robots allows, the sitemap exists and no noindex is sent", () => {
    const line = spec.split("\n").find((l) => !l.trim().startsWith("#") && l.includes("APP_SEARCH_INDEXING"));
    expect(line, "APP_SEARCH_INDEXING is declared").toBeDefined();
    expect(line).toMatch(/value:\s*"on"/);
  });

  it("the dev app serves dev. and admin. only: www and the apex are the production team's (coming soon), never this app's (krizaka-internal#2659)", () => {
    expect(spec).toMatch(/- domain: dev\.verikora\.com\n\s+type: PRIMARY/);
    expect(spec).toMatch(/- domain: admin\.verikora\.com\n\s+type: ALIAS/);
    expect(spec).not.toMatch(/- domain: (www\.)?verikora\.com\n/);
    expect(spec).toMatch(/key: APP_PUBLIC_URL, scope: RUN_AND_BUILD_TIME, value: "https:\/\/dev\.verikora\.com"/);
  });

  it("the dev app spec sets the stage to dev, at build too (the pages are static); no production spec says otherwise (verikora#364)", () => {
    expect(spec).toMatch(/key: APP_ENVIRONMENT, scope: RUN_AND_BUILD_TIME, value: "dev"/);
    // No production spec exists yet: the day one does, it must say `prod`, which hides the notice.
    expect(readdirSync(join(__dirname, "../../../deploy/digitalocean")).filter((f) => f.startsWith("prod"))).toEqual(
      [],
    );
  });
});
