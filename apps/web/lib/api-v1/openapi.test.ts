import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GET as openApiRoute } from "@/app/api/v1/openapi.json/route";

import { VERIKORA_API_KEY_RULES } from "../api-keys";
import { openApiDocument } from "./openapi";

const ROOT = fileURLToPath(new URL("../../app/api/v1", import.meta.url));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** Every `route.ts` under app/api/v1 as « METHOD /api/v1/path/{param} », the methods read from its exports. */
async function routes(): Promise<string[]> {
  const found: string[] = [];
  for (const file of walk(ROOT).filter((f) => f.endsWith(`${sep}route.ts`))) {
    const path =
      "/api/v1/" +
      relative(ROOT, file)
        .split(sep)
        .slice(0, -1)
        .join("/")
        .replace(/\[(\w+)\]/g, "{$1}");
    const exports = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const m of METHODS) if (typeof exports[m] === "function") found.push(`${m} ${path.replace(/\/$/, "")}`);
  }
  return found.sort();
}

const spec = openApiDocument("https://dev.verikora.com");
const documented = Object.entries(spec.paths)
  .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`))
  .sort();

describe("the OpenAPI document of /api/v1 (verikora#202)", () => {
  it("documents every route under app/api/v1, and only those", async () => {
    const actual = await routes();
    expect(actual.length).toBeGreaterThanOrEqual(5);
    expect(documented).toEqual(actual);
  });

  it("every operation has an id, a summary and answers; the secured ones name a scope the keys have", () => {
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops) as [
        string,
        { operationId: string; summary: string; responses: object; security: Record<string, string[]>[] },
      ][]) {
        expect(op.operationId, `${method} ${path}`).toBeTruthy();
        expect(ids.has(op.operationId), `duplicate ${op.operationId}`).toBe(false);
        ids.add(op.operationId);
        expect(op.summary).toBeTruthy();
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
        for (const requirement of op.security)
          for (const scopes of Object.values(requirement))
            for (const scope of scopes) expect(VERIKORA_API_KEY_RULES.scopes).toContain(scope);
      }
    }
  });

  it("every $ref points at a schema that exists", () => {
    const refs = [...JSON.stringify(spec).matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const name of refs) expect(spec.components.schemas, name).toHaveProperty(name);
  });

  it("is served as JSON at the caller's own address", async () => {
    const res = openApiRoute(new Request("http://localhost:3000/api/v1/openapi.json"));
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers).toEqual([{ url: "http://localhost:3000" }]);
  });
});
