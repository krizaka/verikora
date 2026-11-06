import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

// verikora#365: the transfer register (docs/privacy/transfers.json) lists every place personal information can go.
// It follows the deployment spec and the environment schema: a store, host, provider or variable of a data context that
// the register does not list fails here, so the privacy assessment cannot fall behind the configuration.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const register = JSON.parse(read("docs/privacy/transfers.json"));
const spec = read(register.app.spec);
const envSource = read("apps/web/lib/env.ts");

const DATA_CONTEXTS = /^(DATABASE|MEDIA|MAIL|PAYMENTS|AI)_/;
const OWN = /(^|\.)verikora\.com$/;
const listedKeys = new Set(register.entries.flatMap((e) => e.env));
const listedHosts = new Set(register.entries.flatMap((e) => e.hosts));

const specKeys = [...spec.matchAll(/key:\s*([A-Z0-9_]+)\b/g)].map((m) => m[1]);
const specValues = [...spec.matchAll(/key:\s*([A-Z0-9_]+),[^}]*?value:\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]);
const hostOf = (value) => {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
};

describe("the transfer register follows the deployment", () => {
  it("reads the right files (the guard is not vacuous)", () => {
    assert.ok(specKeys.length > 10);
    assert.ok(specKeys.some((k) => DATA_CONTEXTS.test(k)));
    assert.ok(register.entries.length >= 5);
  });
  it("lists the region the app is deployed in", () => {
    assert.match(spec, new RegExp(`^region: ${register.app.region}$`, "m"));
  });
  it("lists every variable of a data context that the spec sets", () => {
    const missing = specKeys.filter((k) => DATA_CONTEXTS.test(k) && !listedKeys.has(k));
    assert.deepEqual(
      missing,
      [],
      `add these to docs/privacy/transfers.json, with where the data goes: ${missing.join(", ")}`,
    );
  });
  it("lists every variable of a data context that the schema declares", () => {
    const declared = [...envSource.matchAll(/^ {2}([A-Z]+_[A-Z0-9_]+):/gm)]
      .map((m) => m[1])
      .filter((k) => DATA_CONTEXTS.test(k));
    assert.ok(declared.length > 10);
    const missing = declared.filter((k) => !listedKeys.has(k));
    assert.deepEqual(missing, [], `add these to docs/privacy/transfers.json: ${missing.join(", ")}`);
  });
  it("lists every host outside verikora.com that the spec's values or the schema's defaults name", () => {
    const fromSpec = specValues
      .filter(([, v]) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(v))
      .map(([, v]) => hostOf(v));
    const fromSchema = [...envSource.matchAll(/default\("(https?:\/\/[^"]+)"\)/g)].map((m) => hostOf(m[1]));
    const hosts = [...new Set([...fromSpec, ...fromSchema])].filter(
      (h) => h && !OWN.test(h) && /[a-z]/i.test(h) && h.includes("."),
    );
    assert.ok(hosts.length >= 3);
    const missing = hosts.filter((h) => !listedHosts.has(h));
    assert.deepEqual(missing, [], `add these to docs/privacy/transfers.json: ${missing.join(", ")}`);
  });
  it("gives each entry the shape the documents rely on, and says whether it leaves Québec (null = not stated)", () => {
    for (const e of register.entries) {
      for (const field of ["id", "role", "provider", "where", "env", "hosts"])
        assert.ok(field in e, `${e.id}: ${field}`);
      assert.ok("outsideQuebec" in e && "outsideCanada" in e, `${e.id}: outsideQuebec / outsideCanada`);
    }
    assert.equal(new Set(register.entries.map((e) => e.id)).size, register.entries.length);
  });
  it("is named in both documents: every entry id appears in transfers.md, and efvp.md points to it", () => {
    const transfers = read("docs/privacy/transfers.md");
    for (const e of register.entries)
      assert.ok(transfers.includes(`\`${e.id}\``), `transfers.md does not name ${e.id}`);
    assert.match(read("docs/privacy/efvp.md"), /transfers\.md/);
  });
});
