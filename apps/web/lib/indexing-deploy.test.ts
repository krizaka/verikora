import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const spec = readFileSync(join(__dirname, "../../../deploy/digitalocean/dev.app.yaml"), "utf8");

describe("www.yomizaka.com is indexed (krizaka-com AGENTS §2.4); dev. and admin. are not", () => {
  it("the dev app spec leaves APP_SEARCH_INDEXING on, so robots allows, the sitemap exists and no noindex is sent", () => {
    const line = spec.split("\n").find((l) => !l.trim().startsWith("#") && l.includes("APP_SEARCH_INDEXING"));
    expect(line, "APP_SEARCH_INDEXING is declared").toBeDefined();
    expect(line).toMatch(/value:\s*"on"/);
  });

  it("the public address is www and the dev address is APP_DEV_HOST (pages 308 to www, the API stays)", () => {
    expect(spec).toMatch(/- domain: www\.yomizaka\.com\n\s+type: PRIMARY/);
    expect(spec).toMatch(/- domain: yomizaka\.com\n\s+type: ALIAS/);
    expect(spec).toMatch(/- domain: dev\.yomizaka\.com\n\s+type: ALIAS/);
    expect(spec).toMatch(/key: APP_PUBLIC_URL, scope: RUN_AND_BUILD_TIME, value: "https:\/\/www\.yomizaka\.com"/);
    expect(spec).toMatch(/key: APP_DEV_HOST, scope: RUN_TIME, value: "dev\.yomizaka\.com"/);
    const apex = spec.slice(spec.indexOf("ingress:"));
    expect(apex).toMatch(/exact: yomizaka\.com[\s\S]*authority: www\.yomizaka\.com[\s\S]*redirect_code: 308/);
  });

  it("the dev app spec sets the stage to dev, at build too (the pages are static); no production spec says otherwise (yomizaka#364)", () => {
    expect(spec).toMatch(/key: APP_ENVIRONMENT, scope: RUN_AND_BUILD_TIME, value: "dev"/);
    // No production spec exists yet: the day one does, it must say `prod`, which hides the notice.
    expect(readdirSync(join(__dirname, "../../../deploy/digitalocean")).filter((f) => f.startsWith("prod"))).toEqual([]);
  });
});
