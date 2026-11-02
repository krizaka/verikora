import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findPackageDir } from "./package-dir";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A tree shaped like the standalone image of the web app (2026-10-29): the package only under `.pnpm` and a hashed alias in `.next/node_modules`, never a plain `node_modules/unpdf`. */
function standalone(): string {
  const root = mkdtempSync(join(tmpdir(), "standalone-"));
  made.push(root);
  const pkg = join(root, "node_modules/.pnpm/unpdf@1.8.1_x/node_modules/unpdf");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), '{"name":"unpdf"}');
  mkdirSync(join(root, "apps/web/.next/node_modules"), { recursive: true });
  return root;
}

describe("findPackageDir", () => {
  it("finds a package that only the .pnpm store holds, from the folder the server runs in (the production image)", async () => {
    const root = standalone();
    expect(await findPackageDir("unpdf", join(root, "apps/web"))).toBe(
      join(root, "node_modules/.pnpm/unpdf@1.8.1_x/node_modules/unpdf"),
    );
  });

  it("prefers the package linked at node_modules/<name> (a workspace install)", async () => {
    const root = standalone();
    const linked = join(root, "apps/web/node_modules/unpdf");
    mkdirSync(linked, { recursive: true });
    writeFileSync(join(linked, "package.json"), '{"name":"unpdf"}');
    expect(await findPackageDir("unpdf", join(root, "apps/web"))).toBe(linked);
  });

  it("does not take a package whose name only starts the same way", async () => {
    const root = standalone();
    await expect(findPackageDir("unpdf-extra", join(root, "apps/web"))).rejects.toThrow(/unpdf-extra/);
  });

  it("finds the real unpdf of this repository", async () => {
    expect(await findPackageDir("unpdf", process.cwd())).toMatch(/unpdf$/);
  });
});
