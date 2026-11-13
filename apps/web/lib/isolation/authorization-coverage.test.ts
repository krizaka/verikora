import { describe, expect, it } from "vitest";

import { VERIKORA_API_KEY_RULES } from "../api-keys/rules";
import { ACCESS, API_SCOPES, AUTHORIZATION, PAGE_LOCK_FOLDER, PAGES_ACCESS } from "./authorization";
import { apiRoutes, pagePaths, routeKeys } from "./routes";

/**
 * The guard of the authorization matrix (krizaka-internal#2382): the route list is read from the file tree (`routes.ts`, the one list
 * customer isolation reads too), so a new route handler or method fails here until `authorization.ts` says who may call it, and a row
 * whose handler is gone fails too. `authorization.integration.test.ts` proves each row on PostgreSQL.
 */
const routes = await apiRoutes();
const keys = routeKeys(routes);

describe("authorization matrix: every route handler has its row (krizaka-internal#2382)", () => {
  it("reads the route tree (the guard is not empty)", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(keys.length).toBeGreaterThan(150);
  });

  it("each method of each route handler has a row", () => {
    const missing = keys.filter((k) => !(k in AUTHORIZATION));
    expect(missing, "add a row to lib/isolation/authorization.ts: who may call it").toEqual([]);
  });

  it("no row names a route or a method that does not exist", () => {
    const real = new Set<string>(keys);
    expect(Object.keys(AUTHORIZATION).filter((k) => !real.has(k))).toEqual([]);
  });

  it("the administration's routes, and only they, are rows of the administration", () => {
    const wrong = Object.entries(AUTHORIZATION)
      .filter(([k, row]) => k.includes(" /api/admin/") !== (row.access === ACCESS.admin))
      .map(([k, row]) => `${k}: ${row.access}`);
    expect(wrong).toEqual([]);
  });

  it("the public API's routes take a key; every other route takes none", () => {
    const wrong = Object.entries(AUTHORIZATION)
      .filter(([k, row]) => row.access === ACCESS.apiKey && !k.includes(" /api/v1/"))
      .map(([k]) => k);
    expect(wrong).toEqual([]);
    const v1 = Object.entries(AUTHORIZATION).filter(([k]) => k.includes(" /api/v1/"));
    expect(v1.filter(([, row]) => row.access !== ACCESS.apiKey).map(([k]) => k)).toEqual(["GET /api/v1/openapi.json"]);
  });

  it("a public route says why it needs no session", () => {
    const silent = Object.entries(AUTHORIZATION)
      .filter(([, row]) => row.access === ACCESS.public && row.why.length < 20)
      .map(([k]) => k);
    expect(silent).toEqual([]);
  });

  it("the matrix's scopes are the API keys' scopes", () => {
    expect([...API_SCOPES].sort()).toEqual([...VERIKORA_API_KEY_RULES.scopes].sort());
  });

  it("each page has a row, and a page of the signed-in space or of the administration lives under the layout that locks it", async () => {
    const pages = await pagePaths();
    expect(
      pages.filter((p) => !(p in PAGES_ACCESS)),
      "add the page to PAGES_ACCESS",
    ).toEqual([]);
    expect(Object.keys(PAGES_ACCESS).filter((p) => !pages.includes(p))).toEqual([]);
    const under = (page: string, folder: string) => page === folder || page.startsWith(`${folder}/`);
    const misplaced = Object.entries(PAGES_ACCESS)
      .filter(
        ([page, access]) =>
          under(page, PAGE_LOCK_FOLDER.member) !== (access === "member") ||
          under(page, PAGE_LOCK_FOLDER.admin) !== (access === "admin"),
      )
      .map(([page, access]) => `${page}: ${access}`);
    expect(misplaced).toEqual([]);
  });
});
