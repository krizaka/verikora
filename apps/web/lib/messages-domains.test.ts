import fs from "node:fs";
import path from "node:path";

import { checkMessages } from "@krizaka/i18n/check";
import { describe, expect, it } from "vitest";

const MESSAGES = path.resolve(import.meta.dirname, "../messages");

const DOMAINS = ["console", "documents", "legal", "marketing", "screening", "site"] as const;
type Domain = (typeof DOMAINS)[number];

/** All leaf-key counts per domain (en reference). Recomputed at test time. */
function domainMessageCount(domain: Domain): number {
  return checkMessages({ dir: path.join(MESSAGES, domain) }).messages;
}

describe("messages domain split", () => {
  it("every domain passes krizaka-i18n check", () => {
    for (const domain of DOMAINS) {
      const result = checkMessages({ dir: path.join(MESSAGES, domain) });
      expect(result.ok, `domain ${domain}: ${result.problems.map((p) => p.message).join("; ")}`).toBe(true);
    }
  });

  it("total message count across all domains equals the flat catalogue", () => {
    const flat = checkMessages({ dir: MESSAGES });
    const domainSum = DOMAINS.reduce((acc, d) => acc + domainMessageCount(d), 0);
    expect(domainSum, "domain sum must equal flat catalogue").toBe(flat.messages);
  });

  it("no domain shares a top-level key with another domain", () => {
    const seen = new Map<string, Domain>();
    for (const domain of DOMAINS) {
      const dir = path.join(MESSAGES, domain);
      const enFile = path.join(dir, "en.json");
      const slice = JSON.parse(fs.readFileSync(enFile, "utf8")) as Record<string, unknown>;
      for (const key of Object.keys(slice)) {
        const prev = seen.get(key);
        expect(prev, `top-level key "${key}" appears in both "${prev}" and "${domain}"`).toBeUndefined();
        seen.set(key, domain);
      }
    }
  });

  // A running-code import of the generated flat file ships every message a second time beside the domain catalogues:
  // the two copies are different modules to the bundler. This took the image over its size budget (verikora#757).
  it("code that ships imports the domain catalogues, never the generated flat files", () => {
    const WEB = path.resolve(import.meta.dirname, "..");
    const FLAT_IMPORT = /from\s+["'][^"']*messages\/(?:en|fr)\.json["']/;
    const isShippedSource = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
    const offenders = ["app", "components", "lib"].flatMap((dir) =>
      fs
        .readdirSync(path.join(WEB, dir), { recursive: true, encoding: "utf8" })
        .filter(isShippedSource)
        .filter((file) => FLAT_IMPORT.test(fs.readFileSync(path.join(WEB, dir, file), "utf8")))
        .map((file) => path.join(dir, file)),
    );
    expect(offenders).toEqual([]);
  });

  it("two branches adding keys to different domains merge without conflict", () => {
    // Branch A: adds a new feature under 'screening'
    const branchAScreening = {
      ...JSON.parse(fs.readFileSync(path.join(MESSAGES, "screening", "en.json"), "utf8")),
      branchAFeature: { title: "Branch A title" },
    };
    const branchAScreeningFr = {
      ...JSON.parse(fs.readFileSync(path.join(MESSAGES, "screening", "fr.json"), "utf8")),
      branchAFeature: { title: "Titre branche A" },
    };

    // Branch B: adds a new feature under 'site'
    const branchBSite = {
      ...JSON.parse(fs.readFileSync(path.join(MESSAGES, "site", "en.json"), "utf8")),
      branchBFeature: { label: "Branch B label" },
    };
    const branchBSiteFr = {
      ...JSON.parse(fs.readFileSync(path.join(MESSAGES, "site", "fr.json"), "utf8")),
      branchBFeature: { label: "Étiquette branche B" },
    };

    // The merge touches different files — no conflict.
    // Verify each domain independently still passes check.
    const tmpDir = path.join(import.meta.dirname, "../../../.tmp-merge-test");
    fs.mkdirSync(path.join(tmpDir, "screening"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "site"), { recursive: true });

    try {
      fs.writeFileSync(path.join(tmpDir, "screening", "en.json"), JSON.stringify(branchAScreening, null, 2));
      fs.writeFileSync(path.join(tmpDir, "screening", "fr.json"), JSON.stringify(branchAScreeningFr, null, 2));
      fs.writeFileSync(path.join(tmpDir, "site", "en.json"), JSON.stringify(branchBSite, null, 2));
      fs.writeFileSync(path.join(tmpDir, "site", "fr.json"), JSON.stringify(branchBSiteFr, null, 2));

      const screeningResult = checkMessages({ dir: path.join(tmpDir, "screening") });
      expect(screeningResult.ok, `merged screening: ${screeningResult.problems.map((p) => p.message).join("; ")}`).toBe(
        true,
      );

      const siteResult = checkMessages({ dir: path.join(tmpDir, "site") });
      expect(siteResult.ok, `merged site: ${siteResult.problems.map((p) => p.message).join("; ")}`).toBe(true);

      // Both new keys survive and are accounted for
      expect(screeningResult.messages).toBeGreaterThan(domainMessageCount("screening"));
      expect(siteResult.messages).toBeGreaterThan(domainMessageCount("site"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
