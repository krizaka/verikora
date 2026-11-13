import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CASES, LISTS, NOT_OWNER_SCOPED, PAGES } from "./cases";

/**
 * The guard of customer isolation (krizaka-internal#2383): the route list is read from the file tree, never typed from memory, so a
 * new route that takes an id fails here until it has its isolation case (`cases.ts`, run on PostgreSQL by
 * `customer-isolation.integration.test.ts`) or a stated reason it is not a door to another customer's rows.
 */
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string, file: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), file) : e.name === file ? [path.join(dir, e.name)] : [],
  );
}

/** The methods a route file exports: `export function GET`, `export const GET =`, `export const { PATCH, DELETE } =`. */
export function methodsOf(source: string): string[] {
  const named = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/gm)].map((m) => m[1]!);
  const destructured = [...source.matchAll(/^export\s+const\s+\{([^}]+)\}\s*=/gm)].flatMap((m) =>
    m[1]!.split(",").map((s) => s.trim()),
  );
  return [...named, ...destructured].filter((m): m is (typeof METHODS)[number] =>
    (METHODS as readonly string[]).includes(m),
  );
}

/** A segment that is a value: `[id]`, `[token]`; `[locale]` and a catch-all are not. */
const ID_SEGMENT = /\[(?!locale\]|\.\.\.)[^\]]+\]/;
/** An id read from the request body: a zod field `…Id(s)` / `ids`, a multipart `…Id` field, the container handlers' parent id. */
const BODY_ID = [/\b(?:\w+Ids?|ids)\s*:\s*z\./, /stringField\(\s*form,\s*"\w+Id"\s*\)/, /\bcontainerHandlers\(/];

interface Route {
  path: string;
  methods: string[];
  idInPath: boolean;
  idInBody: boolean;
}

const routes: Route[] = walk(path.join(APP, "api"), "route.ts").map((file) => {
  const source = readFileSync(file, "utf8");
  const routePath = `/${path.relative(APP, path.dirname(file)).split(path.sep).join("/")}`;
  return {
    path: routePath,
    methods: methodsOf(source),
    idInPath: ID_SEGMENT.test(routePath),
    idInBody: BODY_ID.some((re) => re.test(source)),
  };
});

const exempt = (key: string, routePath: string) =>
  Object.keys(NOT_OWNER_SCOPED).some(
    (rule) => rule === key || rule === routePath || (rule.endsWith("/") && routePath.startsWith(rule)),
  );
const covered = (key: string) => key in CASES || key in LISTS;

describe("customer isolation: every route that takes an id has its case (krizaka-internal#2383)", () => {
  it("reads the route tree (the guard is not empty)", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((r) => r.idInPath).length).toBeGreaterThan(50);
    expect(
      methodsOf("export const { PATCH, DELETE } = x;\nexport function GET() {}\nexport const POST = () => 1;"),
    ).toEqual(["GET", "POST", "PATCH", "DELETE"]);
  });

  it("each method of a route with an id in its path has an isolation case, a list check or a stated reason", () => {
    const missing = routes
      .filter((r) => r.idInPath)
      .flatMap((r) => r.methods.map((m) => ({ key: `${m} ${r.path}`, path: r.path })))
      .filter(({ key, path: p }) => !covered(key) && !exempt(key, p))
      .map(({ key }) => key);
    expect(missing, "add a case to lib/isolation/cases.ts (or a reason to NOT_OWNER_SCOPED)").toEqual([]);
  });

  it("each route that reads an id from its body has an isolation case or a stated reason", () => {
    const missing = routes
      .filter((r) => !r.idInPath && r.idInBody)
      .filter((r) => !r.methods.some((m) => covered(`${m} ${r.path}`)) && !exempt("", r.path))
      .map((r) => r.path);
    expect(missing, "add a case to lib/isolation/cases.ts (or a reason to NOT_OWNER_SCOPED)").toEqual([]);
  });

  it("no case points at a route or a method that does not exist", () => {
    const real = new Set(routes.flatMap((r) => r.methods.map((m) => `${m} ${r.path}`)));
    expect([...Object.keys(CASES), ...Object.keys(LISTS)].filter((k) => !real.has(k))).toEqual([]);
    for (const reason of Object.values(NOT_OWNER_SCOPED)) expect(reason.length).toBeGreaterThan(20);
  });

  it("each console page with an id is mapped to the case of the loader it shares, or says why it reads no row", () => {
    const pages = walk(APP, "page.tsx")
      .map((f) => path.relative(APP, path.dirname(f)).split(path.sep).join("/"))
      .filter((p) => ID_SEGMENT.test(p));
    expect(pages.filter((p) => !(p in PAGES))).toEqual([]);
    expect(Object.keys(PAGES).filter((p) => !pages.includes(p))).toEqual([]);
    const routeTargets = Object.values(PAGES).filter((v) => /^(GET|POST|PUT|PATCH|DELETE) \//.test(v));
    expect(routeTargets.filter((k) => !(k in CASES))).toEqual([]);
  });
});
