import { describe, expect, it } from "vitest";

import { isAdminHost, routeFor } from "./host";

describe("host routing", () => {
  it("serves the console on admin.verikora.com, and only the console", () => {
    expect(isAdminHost("admin.verikora.com")).toBe(true);
    expect(isAdminHost("dev.verikora.com")).toBe(false);
    expect(routeFor("admin.verikora.com", "/en", "en")).toEqual({ kind: "rewrite", path: "/en/console" });
    expect(routeFor("admin.verikora.com", "/fr/users/42", "en")).toEqual({
      kind: "rewrite",
      path: "/fr/console/users/42",
    });
    expect(routeFor("admin.verikora.com", "/", "fr")).toEqual({ kind: "redirect", path: "/fr" });
    expect(routeFor("admin.verikora.com", "/en/console/runs", "en")).toEqual({ kind: "redirect", path: "/en/runs" });
  });
  it("keeps the console out of search engines and out of the product site", () => {
    expect(routeFor("admin.verikora.com", "/robots.txt", "en")).toEqual({ kind: "robotsClosed" });
    expect(routeFor("admin.verikora.com", "/sitemap.xml", "en")).toEqual({ kind: "notFound" });
    expect(routeFor("dev.verikora.com", "/en/console", "en")).toEqual({ kind: "notFound" });
    expect(routeFor("dev.verikora.com", "/fr/console/users", "en")).toEqual({ kind: "notFound" });
  });
  it("leaves the product site as it was", () => {
    expect(routeFor("dev.verikora.com", "/en/app", "en")).toEqual({ kind: "next" });
    expect(routeFor("dev.verikora.com", "/", "fr")).toEqual({ kind: "redirect", path: "/fr" });
    expect(routeFor("dev.verikora.com", "/robots.txt", "en")).toEqual({ kind: "next" });
    expect(routeFor("dev.verikora.com", "/en/consoles", "en")).toEqual({ kind: "next" });
  });
});
