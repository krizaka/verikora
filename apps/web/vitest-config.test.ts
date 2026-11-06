import { describe, expect, it } from "vitest";

import config from "./vitest.config.mjs";

/**
 * verikora#268: the integration files write global rows (settings, rate limits, maintenance flag) read through a cache by other
 * files; side by side on one database they flaked (api-keys rotation, global switch, api audit). The cause is fixed by running
 * the database files one at a time; this keeps it so — a file added to that project can never run in parallel with another.
 */
describe("vitest projects", () => {
  const projects = (config.test?.projects ?? []) as {
    test: { name: string; include: string[]; exclude?: string[]; fileParallelism?: boolean };
  }[];
  const named = (name: string) => projects.find((p) => p.test.name === name)!.test;

  it("the database project runs its files one at a time", () => {
    expect(named("database").fileParallelism).toBe(false);
  });

  it("every integration test file belongs to the database project, never to the parallel unit one", () => {
    expect(named("database").include).toContain("**/*.integration.test.ts");
    expect(named("unit").exclude).toEqual(named("database").include);
  });
});
