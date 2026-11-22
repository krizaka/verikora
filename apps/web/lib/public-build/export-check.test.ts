import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkRoutes, exportDirOf, GUARD_BIN, guardArgs, routeOf } from "../../scripts/check-public-export.mjs";
import { PUBLIC_ROUTES } from "./routes.mjs";

/** The export check of the public build (krizaka-internal#4148): a clean export passes; each way out of the list fails. */
let dir: string;
const put = (file: string, text = "<html></html>") => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const cleanExport = () => {
  for (const route of PUBLIC_ROUTES) {
    put(`${route.slice(1)}/index.html`);
  }
  put("404.html");
  put("_not-found/index.html");
  put("_next/static/chunks/app.js", "export const a = 1;");
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "public-export-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the exported routes", () => {
  it("are the six pages in both languages, nothing else", () => {
    expect(PUBLIC_ROUTES).toEqual([
      "/fr",
      "/fr/docs",
      "/fr/pricing",
      "/fr/contact",
      "/fr/privacy",
      "/en",
      "/en/docs",
      "/en/pricing",
      "/en/contact",
      "/en/privacy",
    ]);
  });

  it("are read from a folder or a flat file alike", () => {
    expect(routeOf("/o", "/o/fr/docs/index.html")).toBe("/fr/docs");
    expect(routeOf("/o", "/o/fr/docs.html")).toBe("/fr/docs");
    expect(routeOf("/o", "/o/fr/index.html")).toBe("/fr");
  });
});

describe("the export check", () => {
  it("passes on the public pages and the host's 404", () => {
    cleanExport();
    expect(checkRoutes(dir)).toEqual([]);
  });

  it.each(["fr/sign-in", "en/download", "fr/terms", "en/app", "fr/rapport/abc"])("fails on the route /%s", (route) => {
    cleanExport();
    put(`${route}/index.html`);
    expect(checkRoutes(dir)).toContain(`route outside the public list: /${route}`);
  });

  it("fails on a missing public route", () => {
    cleanExport();
    rmSync(join(dir, "en/pricing"), { recursive: true });
    expect(checkRoutes(dir)).toContain("missing public route: /en/pricing");
  });
});

describe("exportDirOf", () => {
  const app = "/repo/apps/web";
  it("defaults to out-public in the app", () => {
    expect(exportDirOf(undefined, app)).toBe("/repo/apps/web/out-public");
  });
  it("accepts a folder inside the app", () => {
    expect(exportDirOf("out-public", app)).toBe("/repo/apps/web/out-public");
  });
  it("refuses a folder outside the app", () => {
    expect(() => exportDirOf("../../etc", app)).toThrow(/outside/);
    expect(() => exportDirOf("/etc", app)).toThrow(/outside/);
  });
});

/** The shared guard (@krizaka/config export-guard, krizaka-internal#4623) judges what the pages carry: red on a sign-in link, green on a clean export. */
describe("the shared export guard", () => {
  const appDir = join(__dirname, "../..");
  const guard = async (folder: string) => {
    const org = await import("@krizaka/org");
    const args = guardArgs(relative(appDir, folder), org);
    return spawnSync(process.execPath, [GUARD_BIN, ...args], { cwd: appDir, encoding: "utf8" });
  };
  let inside: string;
  beforeEach(() => {
    inside = mkdtempSync(join(appDir, "guard-fixture-"));
    mkdirSync(join(inside, "fr"));
  });
  afterEach(() => rmSync(inside, { recursive: true, force: true }));

  it("is red on an export with a sign-in link", async () => {
    writeFileSync(join(inside, "fr/index.html"), '<html><a href="/fr/sign-in">Sign in</a></html>');
    const run = await guard(inside);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/sign-in/i);
  });

  it("is green on a clean export", async () => {
    writeFileSync(join(inside, "fr/index.html"), "<html><p>Hello</p></html>");
    expect((await guard(inside)).status).toBe(0);
  });
});
