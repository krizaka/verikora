import { describe, expect, it } from "vitest";

import { CASES, LISTS, NOT_OWNER_SCOPED, PAGES } from "./cases";
import { apiRoutes, hasIdSegment, methodsOf, pagePaths } from "./routes";

/**
 * The guard of customer isolation (krizaka-internal#2383): the route list is read from the file tree (`routes.ts`, the one list the
 * authorization matrix reads too), never typed from memory, so a new route that takes an id fails here until it has its isolation
 * case (`cases.ts`, run on PostgreSQL by `customer-isolation.integration.test.ts`) or a stated reason it is not a door to another
 * customer's rows.
 */
const routes = await apiRoutes();

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

  it("each console page with an id is mapped to the case of the loader it shares, or says why it reads no row", async () => {
    const pages = (await pagePaths()).filter(hasIdSegment);
    expect(pages.filter((p) => !(p in PAGES))).toEqual([]);
    expect(Object.keys(PAGES).filter((p) => !pages.includes(p))).toEqual([]);
    const routeTargets = Object.values(PAGES).filter((v) => /^(GET|POST|PUT|PATCH|DELETE) \//.test(v));
    expect(routeTargets.filter((k) => !(k in CASES))).toEqual([]);
  });
});
