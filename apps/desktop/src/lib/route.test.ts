import { describe, expect, it } from "vitest";

import { hashOf, HOME, parseRoute, type Route, routeOfLink, sectionOf } from "./route";

describe("the window's hash is the screen", () => {
  it("reads back every screen it writes, a folder's path with its slashes included", () => {
    const routes: Route[] = [
      HOME,
      { screen: "library", folder: "/Users/eric/Documents/Baux 2026" },
      { screen: "check", documentId: "d1", analysisId: "a1" },
      { screen: "document", documentId: "d1" },
      { screen: "batches" },
      { screen: "batch", batchId: "b1" },
      { screen: "reports" },
      { screen: "settings" },
    ];
    for (const route of routes) expect(parseRoute(hashOf(route))).toEqual(route);
  });

  it("opens the library on a hash it does not know", () => {
    expect(parseRoute("")).toEqual(HOME);
    expect(parseRoute("#/nowhere")).toEqual(HOME);
    expect(parseRoute("#/check/only-one")).toEqual(HOME);
  });
});

describe("a web link opens the same place in the Mac app", () => {
  it("maps the web's routes to the app's screens", () => {
    expect(routeOfLink("/app/documents/d1/rapport")).toEqual({ screen: "document", documentId: "d1" });
    expect(routeOfLink("/app/check/batches/b1")).toEqual({ screen: "batch", batchId: "b1" });
    expect(routeOfLink("/app/check/batches")).toEqual({ screen: "batches" });
    expect(routeOfLink("/app/settings/stockage?x=1")).toEqual({ screen: "settings" });
  });

  it("opens the library for any other path", () => {
    for (const link of ["/app", "/app/search", "/tarifs", "/", ""]) expect(routeOfLink(link)).toEqual(HOME);
    // Vérifications and its « Lots » tab, at the web's address (verikora#319).
    expect(routeOfLink("/app/verifications")).toEqual({ screen: "reports" });
    expect(routeOfLink("/app/verifications?tab=lots")).toEqual({ screen: "batches" });
  });
});

describe("the sidebar", () => {
  it("lights the entry each screen belongs to", () => {
    expect(sectionOf({ screen: "check", documentId: "d", analysisId: "a" })).toBe("library");
    expect(sectionOf({ screen: "batch", batchId: "b" })).toBe("checks");
    expect(sectionOf({ screen: "document", documentId: "d" })).toBe("checks");
    expect(sectionOf({ screen: "settings" })).toBe("settings");
  });
});
