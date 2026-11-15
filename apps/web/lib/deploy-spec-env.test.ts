import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { productionProblems, readEnv } from "./env";
import { generateSigningKeyBase64 } from "./report-key";

// A deployment whose container refuses to boot fails its health check and is rolled back (krizaka-internal#3878: eleven deployments
// of dev.verikora.com, `MEDIA_DOCUMENTS_TENANT is not set`). This builds the env the web service of each spec gives the container
// — a SECRET's `__NAME__` placeholder replaced by a value of the shape the boot wants — and asserts the boot accepts it.
const specsDir = join(__dirname, "../../../deploy/digitalocean");
const SIGNING_KEY = generateSigningKeyBase64();

/** A valid-shaped stand-in for a secret the spec only names (`__NAME__`). */
const placeholder = (key: string): string => {
  if (key === "AI_API_KEY") {
    return "oz_placeholder";
  }
  if (key === "APP_REPORT_SIGNING_KEY") {
    return SIGNING_KEY;
  }
  return "x".repeat(40);
};

/** The `web` service's own envs (the text before `jobs:`): the key and value of each flow-style entry, single or multi-line. */
function webEnv(spec: string): Record<string, string> {
  const web = spec.split(/^jobs:/m)[0]!;
  const out: Record<string, string> = {};
  for (const m of web.matchAll(/^\s*- \{([^}]*)\}/gms)) {
    const key = /key:\s*([A-Z0-9_]+)/.exec(m[1]!)?.[1];
    const value = /value:\s*"?([^",}\s]*)"?/.exec(m[1]!)?.[1] ?? "";
    if (key) {
      out[key] = /^__[A-Z0-9_]+__$/.test(value) ? placeholder(key) : value;
    }
  }
  return out;
}

const specs = readdirSync(specsDir).filter((name) => name.endsWith(".app.yaml"));

describe("the DigitalOcean specs give the container every key its boot requires", () => {
  it("finds the specs", () => {
    expect(specs).toContain("dev.app.yaml");
  });

  it.each(specs)("%s: productionProblems is empty for the web service's env", (name) => {
    const env = { ...webEnv(readFileSync(join(specsDir, name), "utf8")), NODE_ENV: "production" };
    expect(productionProblems(readEnv(env))).toEqual([]);
  });

  it("refuses a spec that forgets the tenant (the test sees what #3878 was)", () => {
    const { MEDIA_DOCUMENTS_TENANT: _omitted, ...without } = webEnv(
      readFileSync(join(specsDir, "dev.app.yaml"), "utf8"),
    );
    expect(productionProblems(readEnv({ ...without, NODE_ENV: "production" })).join()).toContain(
      "MEDIA_DOCUMENTS_TENANT",
    );
  });
});
