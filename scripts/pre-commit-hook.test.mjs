// The pre-commit hook finds the ratchet in the repository's own node_modules/.bin (by the repo root, not the caller's PATH),
// keeps the violation verdict for a real violation, and says a tool is missing when it is (krizaka-internal#3414).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = new URL("../.githooks/pre-commit", import.meta.url).pathname;
const SAFE_PATH = "/usr/bin:/bin";
const dirs = [];

/** A throwaway repository with the hook installed and one staged TypeScript file; `ratchet` is the body of a fake krizaka-sg-ratchet, or null for none. */
function repoWith(ratchet, { staged = "a.ts" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pre-commit-hook-"));
  dirs.push(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  mkdirSync(join(dir, ".githooks"));
  copyFileSync(HOOK, join(dir, ".githooks", "pre-commit"));
  chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
  if (ratchet !== null) {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const bin = join(dir, "node_modules", ".bin", "krizaka-sg-ratchet");
    writeFileSync(bin, `#!/bin/sh\n${ratchet}\n`);
    chmodSync(bin, 0o755);
  }
  writeFileSync(join(dir, staged), "export const x = 1;\n");
  git("add", staged);
  return dir;
}

/** Runs the hook from a subfolder, with a PATH that holds no node_modules/.bin. */
function run(dir) {
  mkdirSync(join(dir, "sub"), { recursive: true });
  const r = spawnSync("sh", [join(dir, ".githooks", "pre-commit")], {
    cwd: join(dir, "sub"),
    env: { PATH: SAFE_PATH, HOME: dir },
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("pre-commit hook", () => {
  it("says the tool is missing, exit 2, never the violation message", () => {
    const { code, out } = run(repoWith(null));
    expect(code).toBe(2);
    expect(out).toContain("outil absent : krizaka-sg-ratchet — lance `pnpm install`");
    expect(out).not.toContain("new violation");
  });

  it("keeps the violation verdict for a real violation", () => {
    const { code, out } = run(repoWith("exit 1"));
    expect(code).toBe(1);
    expect(out).toContain("a rule found a new violation");
    expect(out).not.toContain("outil absent");
  });

  it("passes on a clean tree", () => {
    expect(run(repoWith("exit 0")).code).toBe(0);
  });

  it("finds the ratchet in the repository's node_modules/.bin although PATH does not hold it", () => {
    const { code, out } = run(repoWith('echo "ran from $PWD"'));
    expect(code).toBe(0);
    expect(out).toContain("ran from");
  });

  it("does nothing when no TypeScript file is staged", () => {
    expect(run(repoWith(null, { staged: "a.md" })).code).toBe(0);
  });
});
