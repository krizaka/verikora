import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The founder's rule (2026-11-06): no Krizaka e-mail address on any public page. « Support » and « Contact » are Krizaka's contact
// form (kind + product in the link). One written exception: the privacy officer's contact on the privacy page (Quebec Law 25).
const ROOT = join(__dirname, "..");
const ADDRESS = /[\w.+-]+@(?:[a-z0-9-]+\.)*(?:krizaka|verikora|folioviv|sovkora|kridoc)\.com/g;
const PRIVACY_OFFICER = "confidentialite@krizaka.com";
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : [rel];
  });
const publicSources = ["app", "components", "messages", "content"]
  .flatMap(files)
  .filter((f) => /\.(tsx?|json|md|txt)$/.test(f) && !/\.test\./.test(f));

describe("no Krizaka e-mail address is public", () => {
  it("the public sources hold no address but the privacy officer's, and no mailto: but the privacy page's", () => {
    const addresses = publicSources.flatMap((f) =>
      (readFileSync(join(ROOT, f), "utf8").match(ADDRESS) ?? []).map((a) => `${f}: ${a}`),
    );
    expect(addresses).toEqual([]);
    const mailtos = publicSources.filter((f) => readFileSync(join(ROOT, f), "utf8").includes("mailto:"));
    expect(mailtos).toEqual(["app/[locale]/privacy/page.tsx"]);
  });

  it("the site has no support address constant; only the privacy officer's is kept", () => {
    const site = readFileSync(join(ROOT, "lib/site.ts"), "utf8");
    expect(site).not.toContain("SUPPORT_EMAIL");
    expect(site.match(ADDRESS)).toEqual([PRIVACY_OFFICER]);
  });
});
