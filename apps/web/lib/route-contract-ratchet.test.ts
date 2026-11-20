// ADR-022 (krizaka-internal#1982): every route handler a client reads gets a contract test (@krizaka/contract). This ratchet counts the
// routes with no sibling test that uses it; the number is recorded below and only goes down.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API = path.join(__dirname, "..", "app", "api");
/** Routes still without a contract test. Lower it when you add one; never raise it. */
const ROUTES_WITHOUT_CONTRACT_TEST = 141;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

describe("route-has-contract-test", () => {
  it("the count of routes without a contract test equals the ratchet", () => {
    const files = walk(API);
    const routes = files.filter((f) => path.basename(f) === "route.ts");
    const covered = new Set(
      files
        .filter((f) => /\.test\.tsx?$/.test(f) && readFileSync(f, "utf8").includes("@krizaka/contract"))
        .map((f) => path.dirname(f)),
    );
    const missing = routes.filter((r) => !covered.has(path.dirname(r))).length;
    expect(missing, "the count moved: lower ROUTES_WITHOUT_CONTRACT_TEST (never raise it)").toBe(
      ROUTES_WITHOUT_CONTRACT_TEST,
    );
  });
});
