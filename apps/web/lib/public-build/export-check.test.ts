import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkExport, routeOf } from "../../scripts/check-public-export.mjs";
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
    expect(checkExport(dir)).toEqual([]);
  });

  it.each(["fr/sign-in", "en/download", "fr/terms", "en/app", "fr/rapport/abc"])("fails on the route /%s", (route) => {
    cleanExport();
    put(`${route}/index.html`);
    expect(checkExport(dir)).toContain(`route outside the public list: /${route}`);
  });

  it("fails on a missing public route", () => {
    cleanExport();
    rmSync(join(dir, "en/pricing"), { recursive: true });
    expect(checkExport(dir)).toContain("missing public route: /en/pricing");
  });

  it.each([
    ["sign-in", '<a href="/fr/sign-in">'],
    ["/api/", 'fetch("/api/me")'],
    ["dev. host", '<a href="https://dev.verikora.com/fr">'],
    ["session cookie", 'document.cookie = "verikora_session=1"'],
  ])("fails on %s in a page", (name, text) => {
    cleanExport();
    put("fr/index.html", text);
    expect(checkExport(dir)).toContain(`${name} in fr/index.html`);
  });

  it("fails on a forbidden word in a script, too", () => {
    cleanExport();
    put("_next/static/chunks/app.js", 'krizakaFetch("/api/me")');
    expect(checkExport(dir)).toContain("/api/ in _next/static/chunks/app.js");
  });

  it("tolerates the family registry's own dev addresses in a script, never in a page, never another one", () => {
    cleanExport();
    put("_next/static/chunks/app.js", 'tS("verikora","https://dev.verikora.com")');
    expect(checkExport(dir)).toEqual([]);
    put("_next/static/chunks/app.js", 'x("https://dev.example.com")');
    expect(checkExport(dir)).toContain("dev. host in _next/static/chunks/app.js");
    put("_next/static/chunks/app.js", "ok");
    put("en/contact/index.html", "https://dev.verikora.com");
    expect(checkExport(dir)).toContain("dev. host in en/contact/index.html");
  });
});
