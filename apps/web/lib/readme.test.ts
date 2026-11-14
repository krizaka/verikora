import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

/** `docs.current`: the README says what runs today — every declared variable, every script it names, every file it links. */
const root = join(__dirname, "../../..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const scripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> })
  .scripts;

describe("README", () => {
  it("lists every environment variable of lib/env.ts", () => {
    for (const key of Object.keys(envSchema.shape)) {
      if (key === "NODE_ENV") continue;
      expect(readme, key).toContain(key);
    }
  });
  it("names only scripts that exist", () => {
    for (const [, name] of readme.matchAll(/pnpm (?:run )?([a-z][a-z:-]*)/g)) {
      if (["install", "dev"].includes(name!)) continue;
      expect(Object.keys(scripts), name).toContain(name);
    }
  });
  it("links only files that exist", () => {
    for (const [, path] of readme.matchAll(/\]\((?!https?:|#)([^)#]+)\)/g))
      expect(existsSync(join(root, path!)), path).toBe(true);
  });
  it("says that the Dev preview is web only, and where the apps live", () => {
    for (const text of [readme, readFileSync(join(root, "docs/agents.md"), "utf8")]) {
      expect(text).toMatch(/web only/i);
      expect(text).toContain("apps/mobile");
    }
  });
});
